import { expect, test, type Browser, type Page } from "@playwright/test";
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

type Session = { page: Page; email: string; close: () => Promise<void> };

async function openContributor(browser: Browser, label: string): Promise<Session> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  completeProfileDirectly(await createConfirmedUser(email, password));

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return { page, email, close: () => context.close() };
}

async function openModerator(browser: Browser, used: Set<string>): Promise<Session> {
  const email = uniqueEmail("moderation");
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  makeModerator(id);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
  await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, used));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/fr\/account/);
  return { page, email, close: () => context.close() };
}

async function fillResource(page: Page, title: string, url: string) {
  await page.getByLabel("Type de ressource").selectOption({ label: "Article" });
  await page.getByLabel("Titre", { exact: true }).fill(title);
  await page.getByLabel("Auteurs").fill("Awa Diop\nKofi Mensah");
  await page.getByLabel("Lien officiel").fill(url);
  await page.getByLabel("Mots-clés").fill("Arbres, Complexité");
  await page.getByLabel("Algorithmique").check();
  await page.getByLabel("Statut d'accès").selectOption({ label: "Accès ouvert" });
  await page.getByLabel("Licence", { exact: true }).selectOption({ label: "CC BY 4.0" });
}

async function decide(page: Page, action: string, reason?: string) {
  await page.getByLabel("Action", { exact: true }).selectOption({ label: action });
  if (reason !== undefined) await page.getByLabel("Motif").fill(reason);
  await page.getByRole("button", { name: "Enregistrer la décision" }).click();
}

test.describe("catalogue : de la proposition à la publication", () => {
  // Les codes du second facteur changent toutes les trente secondes.
  test.setTimeout(180_000);

  test("une ressource proposée est corrigée, vérifiée puis publiée", async ({ browser }) => {
    const used = new Set<string>();
    const title = `Arbres équilibrés ${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const contributor = await openContributor(browser, "contributrice");

    // --- Proposition ------------------------------------------------------
    await contributor.page.goto("/fr/contribute");

    // Formulaire vide : refus par le serveur, champ par champ.
    await contributor.page.getByRole("button", { name: "Envoyer la proposition" }).click();
    await expect(alert(contributor.page)).toHaveText("Certains champs sont à corriger.");
    await expect(contributor.page.getByText("Ce champ est obligatoire.").first()).toBeVisible();

    // Lien dangereux, sans déclaration de droits.
    await fillResource(contributor.page, title, "javascript:alert(1)");
    await contributor.page.getByRole("button", { name: "Envoyer la proposition" }).click();
    await expect(
      contributor.page.getByText("Indiquez une adresse complète commençant par http:// ou https://."),
    ).toBeVisible();
    await expect(
      contributor.page.getByText("Cette déclaration est nécessaire pour proposer une ressource."),
    ).toBeVisible();
    // La saisie est conservée.
    await expect(contributor.page.getByLabel("Titre", { exact: true })).toHaveValue(title);

    await contributor.page.getByLabel("Lien officiel").fill("https://exemple.invalid/arbres");
    await contributor.page.getByLabel("Algorithmique").check();
    await contributor.page.getByLabel(/Je déclare que ce lien mène à une source légale/).check();
    await contributor.page.getByRole("button", { name: "Envoyer la proposition" }).click();

    await expect(contributor.page).toHaveURL(/\/fr\/contributions\?notice=submitted/);
    await expect(status(contributor.page)).toContainText("Votre proposition est enregistrée");
    const item = contributor.page.getByRole("listitem").filter({ hasText: title });
    await expect(item.getByTestId("submission-status")).toHaveText("En attente");

    await item.getByRole("link", { name: title }).click();
    await expect(contributor.page).toHaveURL(/\/fr\/contributions\/[0-9a-f-]{36}$/);
    const contributionUrl = contributor.page.url();
    const resourceId = contributionUrl.split("/").pop()!;

    // --- Modération : demande de correction --------------------------------
    const moderator = await openModerator(browser, used);
    await moderator.page.goto("/fr/moderation");
    await moderator.page.getByRole("link", { name: title }).click();
    await expect(moderator.page).toHaveURL(new RegExp(`/fr/moderation/${resourceId}`));
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("En attente");
    // Les auteurs et le lien sont affichés ; le lien ne suit pas le référent.
    await expect(moderator.page.getByRole("main")).toContainText("Awa Diop, Kofi Mensah");
    await expect(
      moderator.page.getByRole("link", { name: "https://exemple.invalid/arbres" }),
    ).toHaveAttribute("rel", /noopener/);

    // Une publication directe n'est pas proposée ; une demande sans motif est refusée.
    await expect(
      moderator.page.getByLabel("Action", { exact: true }).locator("option", { hasText: "Publier" }),
    ).toHaveCount(0);
    await decide(moderator.page, "Demander une correction");
    await expect(alert(moderator.page)).toHaveText("Un motif est nécessaire pour cette décision.");

    await decide(moderator.page, "Demander une correction", "Merci de préciser l'année de publication.");
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("Correction demandée");

    // --- Contributrice : correction -----------------------------------------
    await contributor.page.goto(contributionUrl);
    await expect(contributor.page.getByTestId("submission-status")).toHaveText("Correction demandée");
    await expect(contributor.page.getByTestId("history-reason")).toHaveText(
      "Merci de préciser l'année de publication.",
    );
    await contributor.page.getByLabel("Année de publication").fill("2024");
    await contributor.page.getByLabel(/Je déclare que ce lien mène à une source légale/).check();
    await contributor.page
      .getByRole("button", { name: "Enregistrer et renvoyer à la modération" })
      .click();
    await expect(contributor.page).toHaveURL(/\/fr\/contributions\?notice=updated/);

    // --- Modération : vérification puis publication -------------------------
    await moderator.page.goto(`/fr/moderation/${resourceId}`);
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("En attente");
    await expect(moderator.page.getByRole("main")).toContainText("2024");
    // La vérification n'est proposée qu'une fois la fiche prise en charge : dès
    // lors, le contributeur ne peut plus la modifier.
    await expect(
      moderator.page.getByLabel("Action", { exact: true }).locator("option", { hasText: "Vérifier" }),
    ).toHaveCount(0);
    await decide(moderator.page, "Prendre en charge");
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("En cours d'examen");
    await contributor.page.goto(contributionUrl);
    await expect(
      contributor.page.getByRole("button", { name: "Enregistrer et renvoyer à la modération" }),
    ).toHaveCount(0);
    await decide(moderator.page, "Vérifier");
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("Vérifiée");
    await decide(moderator.page, "Publier");
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("Publiée");

    // --- Contributrice : publiée, plus modifiable ----------------------------
    await contributor.page.goto(contributionUrl);
    await expect(contributor.page.getByTestId("submission-status")).toHaveText("Publiée");
    await expect(
      contributor.page.getByRole("button", { name: "Enregistrer et renvoyer à la modération" }),
    ).toHaveCount(0);
    await expect(
      contributor.page.getByRole("button", { name: "Retirer ma proposition" }),
    ).toHaveCount(0);

    // --- Modération : changer la licence renvoie en attente ------------------
    await moderator.page.goto(`/fr/moderation/${resourceId}`);
    await moderator.page
      .getByLabel("Licence", { exact: true })
      .selectOption({ label: "Tous droits réservés" });
    await moderator.page.getByLabel("Notes de modération").fill("Licence à revoir avec l'éditeur.");
    await moderator.page.getByRole("button", { name: "Enregistrer la correction" }).click();
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("En attente");

    // Les notes internes ne sont pas montrées à la contributrice.
    await contributor.page.goto(contributionUrl);
    await expect(contributor.page.getByRole("main")).not.toContainText(
      "Licence à revoir avec l'éditeur.",
    );

    await contributor.close();
    await moderator.close();
  });

  test("une modératrice ne traite pas sa propre proposition", async ({ browser }) => {
    const used = new Set<string>();
    const title = `Soumission interne ${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const moderator = await openModerator(browser, used);

    await moderator.page.goto("/fr/contribute");
    await fillResource(moderator.page, title, "https://exemple.invalid/interne");
    await moderator.page.getByLabel(/Je déclare que ce lien mène à une source légale/).check();
    await moderator.page.getByRole("button", { name: "Envoyer la proposition" }).click();
    await expect(moderator.page).toHaveURL(/\/fr\/contributions\?notice=submitted/);

    await moderator.page.goto("/fr/moderation");
    await moderator.page.getByRole("link", { name: title }).click();
    await decide(moderator.page, "Prendre en charge");
    await expect(alert(moderator.page)).toContainText(
      "Vous ne pouvez pas traiter votre propre soumission",
    );
    await expect(moderator.page.getByTestId("resource-status")).toHaveText("En attente");
    await moderator.close();
  });
});

test.describe("catalogue : cloisonnement", () => {
  test("les pages de modération sont introuvables pour un utilisateur ordinaire", async ({
    browser,
  }) => {
    const user = await openContributor(browser, "ordinaire");
    for (const path of ["/fr/moderation", "/fr/moderation/00000000-0000-0000-0000-000000000000"]) {
      const response = await user.page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await expect(user.page.getByRole("link", { name: "Modération" })).toHaveCount(0);
    await user.close();
  });

  test("une proposition en attente n'est visible que de son auteur", async ({ browser }) => {
    const title = `Proposition privée ${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const author = await openContributor(browser, "auteure");
    await author.page.goto("/fr/contribute");
    await fillResource(author.page, title, "https://exemple.invalid/privee");
    await author.page.getByLabel(/Je déclare que ce lien mène à une source légale/).check();
    await author.page.getByRole("button", { name: "Envoyer la proposition" }).click();
    await author.page.getByRole("link", { name: title }).click();
    await expect(author.page).toHaveURL(/\/fr\/contributions\/[0-9a-f-]{36}$/);
    const url = new URL(author.page.url()).pathname;

    const other = await openContributor(browser, "curieux");
    const response = await other.page.goto(url);
    expect(response?.status()).toBe(404);
    await other.page.goto("/fr/contributions");
    await expect(other.page.getByText(title)).toHaveCount(0);

    // L'auteure retire sa proposition.
    await author.page.getByRole("button", { name: "Retirer ma proposition" }).click();
    await expect(author.page).toHaveURL(/\/fr\/contributions\?notice=withdrawn/);
    const item = author.page.getByRole("listitem").filter({ hasText: title });
    await expect(item.getByTestId("submission-status")).toHaveText("Retirée");

    await author.close();
    await other.close();
  });

  test("les pages du catalogue exigent une session et un profil complété", async ({
    page,
    browser,
  }) => {
    for (const path of ["/fr/contribute", "/fr/contributions", "/fr/moderation"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/fr\/sign-in\?next=/);
    }

    // Compte connecté dont le profil n'est pas complété.
    const email = uniqueEmail("incomplet");
    const password = strongPassword();
    await createConfirmedUser(email, password);
    const context = await browser.newContext();
    const incomplete = await context.newPage();
    await signInThroughForm(incomplete, email, password);
    await expect(incomplete).toHaveURL(/\/fr\/account/);
    await incomplete.goto("/fr/contribute");
    await expect(incomplete).toHaveURL(/\/fr\/account\/profile/);
    await context.close();
  });
});
