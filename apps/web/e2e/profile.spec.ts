import { expect, test, type Page } from "@playwright/test";
import {
  createConfirmedUser,
  signInThroughForm,
  strongPassword,
  uniqueEmail,
} from "./support/auth";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function signInNewUser(page: Page) {
  const email = uniqueEmail("profil");
  const password = strongPassword();
  await createConfirmedUser(email, password);
  await signInThroughForm(page, email, password);
  return { email, password };
}

async function completeProfile(page: Page) {
  await page.getByLabel("Pays", { exact: true }).selectOption({ label: "Sénégal" });
  await page.getByLabel("Niveau d'études").selectOption({ label: "Licence 3" });
  await page.getByLabel(/Je déclare avoir l'âge requis/).check();
  await page.getByRole("button", { name: "Enregistrer mon profil" }).click();
  await expect(page).toHaveURL(/\/fr\/account\?notice=profile-saved/);
}

test.describe("profil académique", () => {
  test("à la première connexion, le profil est demandé avant le compte", async ({ page }) => {
    const { email } = await signInNewUser(page);

    await expect(page).toHaveURL(/\/fr\/account\/profile/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bienvenue sur EduScholar");
    await expect(page.getByTestId("account-email")).toHaveText(email);

    // Tant que le profil n'est pas complet, la page du compte y renvoie.
    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/account\/profile/);
  });

  test("un profil incomplet est refusé par le serveur, champ par champ", async ({ page }) => {
    await signInNewUser(page);
    await expect(page).toHaveURL(/\/fr\/account\/profile/);

    await page.getByRole("button", { name: "Enregistrer mon profil" }).click();

    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await expect(page.getByText("Ce champ est obligatoire.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/fr\/account\/profile/);
  });

  test("sans déclaration d'âge, le profil n'est pas enregistré", async ({ page }) => {
    await signInNewUser(page);

    await page.getByLabel("Pays", { exact: true }).selectOption({ label: "Sénégal" });
    await page.getByLabel("Niveau d'études").selectOption({ label: "Licence 3" });
    await page.getByRole("button", { name: "Enregistrer mon profil" }).click();

    await expect(
      page.getByText("Cette déclaration est nécessaire pour créer un compte."),
    ).toBeVisible();

    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/account\/profile/);
  });

  test("le profil s'enregistre, s'affiche puis se modifie", async ({ page }) => {
    const { email } = await signInNewUser(page);

    // Le lycée, désactivé, n'est pas proposé.
    await expect(page.getByLabel("Niveau d'études").locator("option", { hasText: "Lycée" })).toHaveCount(0);

    await page.getByLabel("Pays", { exact: true }).selectOption({ label: "Sénégal" });
    await page.getByLabel("Niveau d'études").selectOption({ label: "Licence 3" });
    await page.getByLabel("Spécialité (facultatif)").selectOption({ label: "Cybersécurité" });
    await page.getByLabel("Algorithmique").check();
    await page.getByLabel("Bases de données").check();
    await page.getByLabel("Établissement (facultatif)").fill("Université de test");
    await page.getByLabel("Préparer un mémoire ou une thèse").check();
    await page.getByLabel(/Je déclare avoir l'âge requis/).check();
    await page.getByRole("button", { name: "Enregistrer mon profil" }).click();

    await expect(page).toHaveURL(/\/fr\/account\?notice=profile-saved/);
    await expect(status(page)).toHaveText("Votre profil est enregistré.");
    await expect(page.getByTestId("account-email")).toHaveText(email);
    const summary = page.getByRole("main");
    await expect(summary).toContainText("Sénégal");
    await expect(summary).toContainText("Licence 3");
    await expect(summary).toContainText("Informatique");
    await expect(summary).toContainText("Cybersécurité");
    await expect(summary).toContainText("Université de test");

    // Modification : les valeurs enregistrées sont reprises, la déclaration
    // d'âge n'est plus demandée.
    await page.getByRole("link", { name: "Modifier mon profil" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mon profil");
    await expect(page.getByLabel("Pays", { exact: true })).toHaveValue("SN");
    await expect(page.getByLabel("Algorithmique")).toBeChecked();
    await expect(page.getByLabel("Génie logiciel", { exact: true }).first()).not.toBeChecked();
    await expect(page.getByLabel(/Je déclare avoir l'âge requis/)).toHaveCount(0);

    // Changer de langue préférée affiche la suite dans cette langue.
    await page.getByLabel("Pays", { exact: true }).selectOption({ label: "Cameroun" });
    await page.getByLabel("Langue préférée").selectOption({ label: "English" });
    await page.getByRole("button", { name: "Enregistrer mon profil" }).click();

    await expect(page).toHaveURL(/\/en\/account\?notice=profile-saved/);
    await expect(page.getByRole("main")).toContainText("Cameroon");
    await expect(page.getByRole("main")).toContainText("Bachelor year 3");
  });

  test("le profil d'une personne n'apparaît pas chez une autre", async ({ browser }) => {
    const first = await browser.newContext();
    const firstPage = await first.newPage();
    await signInNewUser(firstPage);
    await firstPage.getByLabel("Établissement (facultatif)").fill("Établissement confidentiel");
    await completeProfile(firstPage);
    await first.close();

    const second = await browser.newContext();
    const secondPage = await second.newPage();
    await signInNewUser(secondPage);
    await expect(secondPage).toHaveURL(/\/fr\/account\/profile/);
    await expect(secondPage.getByLabel("Établissement (facultatif)")).toHaveValue("");
    await expect(secondPage.getByLabel("Pays", { exact: true })).toHaveValue("");
    await second.close();
  });

  test("les pages du profil exigent une session", async ({ page }) => {
    for (const path of ["/fr/account/profile", "/fr/account/delete"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/fr\/sign-in\?next=/);
    }
  });
});

test.describe("suppression du compte", () => {
  test("le compte ne se supprime qu'avec le mot de passe et une confirmation", async ({
    page,
  }) => {
    const { email, password } = await signInNewUser(page);
    await completeProfile(page);

    await page.getByRole("link", { name: "Supprimer mon compte" }).click();
    await expect(page).toHaveURL(/\/fr\/account\/delete/);

    // Mauvais mot de passe.
    await page.getByLabel("Mot de passe").fill("MauvaisMotDePasse1");
    await page.getByLabel("Je comprends que la suppression est définitive.").check();
    await page.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
    await expect(alert(page)).toHaveText(
      "Adresse ou mot de passe incorrect, ou adresse non encore confirmée.",
    );

    // Bon mot de passe, sans confirmation.
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
    await expect(page.getByText("Ce champ est obligatoire.")).toBeVisible();

    // Le compte existe toujours.
    await page.goto("/fr/account");
    await expect(page.getByTestId("account-email")).toHaveText(email);

    // Bon mot de passe et confirmation.
    await page.goto("/fr/account/delete");
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByLabel("Je comprends que la suppression est définitive.").check();
    await page.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();

    await expect(page).toHaveURL(/\/fr\/sign-in\?notice=account-deleted/);
    await expect(status(page)).toHaveText("Votre compte a été supprimé.");

    // La connexion n'est plus possible.
    await signInThroughForm(page, email, password);
    await expect(alert(page)).toHaveText(
      "Adresse ou mot de passe incorrect, ou adresse non encore confirmée.",
    );
  });
});
