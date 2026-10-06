import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  makeModerator,
  signInThroughForm,
  strongPassword,
  TEST_FACTOR_SECRET,
  uniqueEmail,
} from "./support/auth";
import { freshTotp } from "./support/totp";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function signInOnboarded(page: Page, label: string) {
  const email = uniqueEmail(label);
  const password = strongPassword();
  completeProfileDirectly(await createConfirmedUser(email, password));
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
}

test.describe("projet de recherche privé", () => {
  test.setTimeout(120_000);

  test("création, fiche, cloisonnement et suppression", async ({ page, browser }) => {
    const title = `Détection d'intrusions ${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    await signInOnboarded(page, "projet");

    await page.getByRole("link", { name: "Mes projets de recherche" }).click();
    await expect(page).toHaveURL(/\/fr\/projects/);
    await expect(page.getByRole("heading", { name: "Aucun projet" })).toBeVisible();

    // Titre trop court : refus, saisie conservée.
    await page.getByLabel("Titre provisoire").fill("ab");
    await page.getByRole("button", { name: "Créer le projet" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await expect(page.getByLabel("Titre provisoire")).toHaveValue("ab");

    await page.getByLabel("Titre provisoire").fill(title);
    await page.getByRole("button", { name: "Créer le projet" }).click();
    await expect(page).toHaveURL(/\/fr\/projects\/[0-9a-f-]{36}\/edit\?notice=created/);
    await expect(status(page)).toContainText("Le projet est créé");
    const projectUrl = page.url().replace(/\/edit.*$/, "");

    // --- Fiche ---------------------------------------------------------------
    await page.getByLabel("État d'avancement").selectOption({ label: "En cours" });
    await page.getByLabel("Échéance").fill("30/06/2027");
    await page.getByLabel("Problématique", { exact: true }).fill("Première ligne.\nSeconde ligne.");
    await page.getByRole("button", { name: "Enregistrer la fiche" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await expect(page.getByRole("main")).toContainText("format AAAA-MM-JJ, par exemple");
    // La saisie est conservée.
    await expect(page.getByLabel("Problématique", { exact: true })).toHaveValue(
      "Première ligne.\nSeconde ligne.",
    );

    await page.getByLabel("Échéance").fill("2027-06-30");
    await page.getByLabel("Encadreur").fill("Pr Ndiaye");
    await page.getByLabel("Question principale").fill("Quels modèles détectent le mieux ?");
    await page
      .getByLabel("Hypothèses")
      .fill("Les forêts aléatoires suffisent.\n\n<script>alert(1)</script>\nLes forêts aléatoires suffisent.");
    await page.getByLabel("Plan provisoire").fill("1. Introduction\n2. État de l'art");
    await page.getByRole("button", { name: "Enregistrer la fiche" }).click();

    await expect(page).toHaveURL(new RegExp(`${projectUrl}\\?notice=saved`));
    await expect(status(page)).toContainText("La fiche du projet est enregistrée");
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(main).toContainText("En cours");
    await expect(main).toContainText("30 juin 2027");
    await expect(main).toContainText("Pr Ndiaye");
    await expect(main).toContainText("Quels modèles détectent le mieux ?");
    await expect(main).toContainText("Ce projet est privé");
    // Deux hypothèses : le doublon est retiré, le balisage reste du texte.
    const hypotheses = main
      .getByRole("heading", { name: "Hypothèses" })
      .locator("xpath=following-sibling::ol[1]/li");
    await expect(hypotheses).toHaveText(["Les forêts aléatoires suffisent.", "<script>alert(1)</script>"]);

    await page.goto("/fr/projects");
    await expect(page.getByRole("heading", { name: "1 projet" })).toBeVisible();
    await expect(page.getByTestId("project-status")).toHaveText("En cours");
    await expect(main).toContainText("Échéance : 30 juin 2027");

    // --- Cloisonnement : autre utilisateur, modératrice ----------------------
    const context = await browser.newContext();
    const other = await context.newPage();
    await signInOnboarded(other, "projet-autre");
    for (const path of [projectUrl, `${projectUrl}/edit`]) {
      expect((await other.goto(path))?.status(), path).toBe(404);
    }
    await other.goto("/fr/projects");
    await expect(other.getByRole("heading", { name: "Aucun projet" })).toBeVisible();
    await context.close();

    const moderatorContext = await browser.newContext();
    const moderator = await moderatorContext.newPage();
    const email = uniqueEmail("projet-moderation");
    const password = strongPassword();
    const id = await createConfirmedUser(email, password);
    completeProfileDirectly(id);
    makeModerator(id);
    await signInThroughForm(moderator, email, password);
    await moderator.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, new Set()));
    await moderator.getByRole("button", { name: "Vérifier" }).click();
    await expect(moderator).toHaveURL(/\/fr\/account/);
    expect((await moderator.goto(projectUrl))?.status()).toBe(404);
    await moderatorContext.close();

    // --- Suppression ---------------------------------------------------------
    await page.goto(projectUrl);
    await page.getByRole("button", { name: "Supprimer ce projet" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await page.getByLabel("Je veux supprimer ce projet et tout ce qu'il contient.").check();
    await page.getByRole("button", { name: "Supprimer ce projet" }).click();
    await expect(page).toHaveURL(/\/fr\/projects\?notice=deleted/);
    await expect(page.getByRole("heading", { name: "Aucun projet" })).toBeVisible();
    expect((await page.goto(projectUrl))?.status()).toBe(404);
  });

  test("les projets exigent une session", async ({ page }) => {
    await page.goto("/fr/projects");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Fprojects/);
    await page.goto(`/fr/projects/${randomUUID()}`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
  });
});
