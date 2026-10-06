import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  signInThroughForm,
  sql,
  strongPassword,
  uniqueEmail,
} from "./support/auth";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function signInOnboarded(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return id;
}

/** Un projet et deux sources, créés directement en base pour le compte donné. */
function seedProject(ownerId: string) {
  const projectId = randomUUID();
  const token = `plan${Date.now()}${Math.round(Math.random() * 1e6)}`;
  sql(`
    insert into public.research_projects (id, owner_id, title) values ('${projectId}', '${ownerId}', 'Mémoire ${token}');
    insert into public.project_sources (project_id, source_type, title, authors, publication_year) values
      ('${projectId}', 'article', 'Réseaux profonds ${token}', array['Diop, Awa'], 2021),
      ('${projectId}', 'book', 'Manuel ${token}', array['Mensah, Kofi'], 2019)
  `);
  return { projectId, token };
}

async function addSection(page: Page, title: string, level: string) {
  await page.getByLabel("Titre de la section").fill(title);
  await page.getByLabel("Niveau de titre").selectOption({ label: level });
  await page.getByRole("button", { name: "Ajouter au plan" }).click();
  await expect(page).toHaveURL(/\/outline\/[0-9a-f-]{36}\?notice=added/);
}

test.describe("plan du mémoire", () => {
  test.setTimeout(150_000);

  test("plan, rédaction, citations, conflit et cloisonnement", async ({ page, browser }) => {
    const ownerId = await signInOnboarded(page, "plan");
    const { projectId, token } = seedProject(ownerId);
    const outline = `/fr/projects/${projectId}/outline`;

    await page.goto(`/fr/projects/${projectId}`);
    await expect(page.getByTestId("section-count")).toHaveText("Aucune section rédigée pour l'instant.");
    await page.getByRole("link", { name: "Ouvrir le plan du mémoire" }).click();
    await expect(page).toHaveURL(new RegExp(outline));
    await expect(page.getByRole("heading", { name: "Aucune section" })).toBeVisible();

    // Titre vide : refus.
    await page.getByRole("button", { name: "Ajouter au plan" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");

    // --- Trois sections ------------------------------------------------------
    await addSection(page, "Introduction", "Chapitre");
    const introUrl = page.url().split("?")[0] ?? "";
    await page.goto(outline);
    await addSection(page, "Méthodes classiques", "Section");
    await page.goto(outline);
    await addSection(page, "État de l'art", "Chapitre");
    const stateUrl = page.url().split("?")[0] ?? "";

    await page.goto(outline);
    await expect(page.getByRole("heading", { name: "3 sections" })).toBeVisible();
    const items = page.getByTestId("outline-item");
    await expect(items.getByRole("link")).toHaveText([
      "1 Introduction",
      "1.1 Méthodes classiques",
      "2 État de l'art",
    ]);

    // --- Réordonner : « État de l'art » passe avant « Méthodes classiques » ---
    await page.getByRole("button", { name: "Monter « État de l'art »" }).click();
    await expect(page).toHaveURL(/notice=moved/);
    await expect(items.getByRole("link")).toHaveText([
      "1 Introduction",
      "2 État de l'art",
      "2.1 Méthodes classiques",
    ]);
    // La première ne monte pas, la dernière ne descend pas.
    await expect(page.getByRole("button", { name: "Monter « Introduction »" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Descendre « Méthodes classiques »" })).toHaveCount(0);

    // --- Rédaction -----------------------------------------------------------
    await page.goto(stateUrl);
    await expect(page.getByTestId("word-count")).toHaveText("Aucun mot");
    const text = "Les réseaux profonds dominent.\n\n<script>alert(1)</script> reste du texte.";
    await page.getByLabel("Texte de la section").fill(text);
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(page).toHaveURL(/notice=saved/);
    await expect(status(page)).toContainText("La section est enregistrée");
    await expect(page.getByLabel("Texte de la section")).toHaveValue(text);
    await expect(page.getByTestId("word-count")).toHaveText("11 mots");

    // --- Conflit : la section change ailleurs pendant la saisie --------------
    await page.getByLabel("Texte de la section").fill("Version de cet onglet.");
    const sectionId = stateUrl.split("/").pop();
    sql(`update public.thesis_sections set body = 'Version d''un autre appareil.' where id = '${sectionId}'`);
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(alert(page)).toContainText("modifiée ailleurs");
    // Rien n'est écrasé en base, et la saisie n'est pas perdue à l'écran.
    await expect(page.getByLabel("Texte de la section")).toHaveValue("Version de cet onglet.");
    await page.reload();
    await expect(page.getByLabel("Texte de la section")).toHaveValue("Version d'un autre appareil.");

    // --- Déplacer une section ailleurs ne provoque pas de faux conflit --------
    await page.getByLabel("Texte de la section").fill("Premier paragraphe.\n\nSecond paragraphe.");
    {
      const context = await browser.newContext({
        storageState: await page.context().storageState(),
        extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.9" },
      });
      const tab = await context.newPage();
      await tab.goto(outline);
      await tab.getByRole("button", { name: "Descendre « État de l'art »" }).click();
      await expect(tab).toHaveURL(/notice=moved/);
      await context.close();
    }
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(page).toHaveURL(/notice=saved/);
    // Stocké avec des sauts de ligne simples.
    await expect(page.getByLabel("Texte de la section")).toHaveValue(
      "Premier paragraphe.\n\nSecond paragraphe.",
    );

    // --- Sources citées ------------------------------------------------------
    await expect(page.getByRole("heading", { name: "Sources citées (0)" })).toBeVisible();
    await page.getByLabel("Source à citer").selectOption({ label: `Diop, Awa · 2021 · Réseaux profonds ${token}` });
    await page.getByLabel("Pages citées").fill("p. 12-14");
    await page.getByRole("button", { name: "Citer cette source" }).click();
    await expect(page).toHaveURL(/notice=cited/);
    await expect(page.getByRole("heading", { name: "Sources citées (1)" })).toBeVisible();
    await expect(page.getByTestId("citation")).toContainText(`Réseaux profonds ${token}`);
    await expect(page.getByTestId("citation")).toContainText("p. 12-14");
    // La source déjà citée n'est plus proposée.
    await expect(
      page.getByLabel("Source à citer").locator("option", { hasText: "Réseaux profonds" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Retirer la citation" }).click();
    await expect(page).toHaveURL(/notice=citation-removed/);
    await expect(page.getByRole("heading", { name: "Sources citées (0)" })).toBeVisible();

    // --- Cloisonnement -------------------------------------------------------
    const context = await browser.newContext();
    const other = await context.newPage();
    const otherId = await signInOnboarded(other, "plan-autre");
    for (const path of [outline, stateUrl]) {
      expect((await other.goto(path))?.status(), path).toBe(404);
    }
    // Une section servie sous un projet qui n'est pas le sien : introuvable.
    const otherProject = seedProject(otherId).projectId;
    expect((await other.goto(`/fr/projects/${otherProject}/outline/${sectionId}`))?.status()).toBe(404);
    await context.close();

    // --- Suppression ---------------------------------------------------------
    await page.goto(introUrl);
    await page.getByRole("button", { name: "Supprimer cette section" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await page.getByLabel("Je veux supprimer cette section et son texte.").check();
    await page.getByRole("button", { name: "Supprimer cette section" }).click();
    await expect(page).toHaveURL(/outline\?notice=deleted/);
    await expect(items.getByRole("link")).toHaveText(["1.1 Méthodes classiques", "1 État de l'art"]);
    expect((await page.goto(introUrl))?.status()).toBe(404);

    await page.goto(`/fr/projects/${projectId}`);
    await expect(page.getByTestId("section-count")).toHaveText("2 sections au plan.");
  });

  test("le plan exige une session", async ({ page }) => {
    const id = randomUUID();
    await page.goto(`/fr/projects/${id}/outline`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
    await page.goto(`/fr/projects/${id}/outline/${randomUUID()}`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
  });
});
