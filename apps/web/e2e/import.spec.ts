import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  makeModerator,
  signInThroughForm,
  sql,
  sqlValue,
  strongPassword,
  TEST_FACTOR_SECRET,
  uniqueEmail,
} from "./support/auth";
import { freshTotp } from "./support/totp";

// La source interrogée est le faux serveur Crossref de e2e/support.

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function openModerator(browser: Browser, used: Set<string>) {
  const email = uniqueEmail("import");
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
  return { page, close: () => context.close() };
}

async function importDoi(page: Page, doi: string, language?: string) {
  await page.goto("/fr/moderation/import");
  await page.getByLabel("DOI").fill(doi);
  if (language) await page.getByLabel("Langue du document").selectOption({ label: language });
  await page.getByRole("button", { name: "Importer" }).click();
}

test.describe("import d'une ressource par DOI", () => {
  test.setTimeout(120_000);

  test("une modératrice importe un article, qui entre en file de modération", async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const doi = `10.5555/e2e.article.${suffix}`;
    const moderator = await openModerator(browser, new Set());
    const { page } = moderator;

    await page.goto("/fr/moderation");
    await page.getByRole("link", { name: "Importer une ressource par son DOI" }).click();
    await expect(page).toHaveURL(/\/fr\/moderation\/import/);

    // Le DOI est accepté sous forme de lien.
    await importDoi(page, `https://doi.org/${doi.toUpperCase()}`);
    await expect(page).toHaveURL(/\/fr\/moderation\/[0-9a-f-]{36}\?notice=imported/);
    await expect(status(page)).toContainText("La fiche est importée");

    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Article de test ${suffix}`);
    await expect(page.getByTestId("resource-status")).toHaveText("En attente");
    await expect(main).toContainText("Awa Diop");
    await expect(main).toContainText("2024");
    await expect(main).toContainText("crossref");
    await expect(main).toContainText("CC BY 4.0");
    // Rien n'est déduit : le statut d'accès reste à vérifier, le résumé n'est pas repris.
    await expect(main).toContainText("Inconnu");
    await expect(main).not.toContainText("Résumé du faux serveur");
    await expect(main.getByRole("link", { name: `https://doi.org/${doi}` })).toBeVisible();
    const resourceUrl = page.url().split("?")[0] ?? "";

    // Le même DOI importé une seconde fois renvoie à la fiche existante.
    await importDoi(page, doi);
    await expect(page).toHaveURL(/notice=already-imported/);
    expect(page.url().split("?")[0]).toBe(resourceUrl);
    await expect(status(page)).toContainText("figure déjà au catalogue");

    // Tant que rien n'est corrigé, la fiche ne signale aucune modification.
    await page.goto(resourceUrl);
    await expect(main).not.toContainText("Modifié depuis l'import");
    // L'importatrice corrige la licence : la fiche dit ce qui ne vient plus de la source.
    await page.getByLabel("Licence", { exact: true }).selectOption({ label: "Tous droits réservés" });
    await page.getByRole("button", { name: "Enregistrer la correction" }).click();
    await expect(main).toContainText("Modifié depuis l'import");
    await expect(
      main.locator("dt", { hasText: "Modifié depuis l'import" }).locator("xpath=following-sibling::dd[1]"),
    ).toHaveText("Licence");

    // La fiche suit le circuit ordinaire, avec un second regard : l'importatrice
    // la prend en charge mais ne peut pas la vérifier elle-même.
    await page.getByLabel("Action", { exact: true }).selectOption({ label: "Prendre en charge" });
    await page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(page.getByTestId("resource-status")).toHaveText("En cours d'examen");
    await page.getByLabel("Action", { exact: true }).selectOption({ label: "Vérifier" });
    await page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(alert(page)).toContainText("Vous ne pouvez pas traiter");

    // Un autre modérateur : pas de vérification sans statut d'accès connu.
    const second = await openModerator(browser, new Set());
    await second.page.goto(resourceUrl);
    await second.page.getByLabel("Action", { exact: true }).selectOption({ label: "Vérifier" });
    await second.page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(alert(second.page)).toContainText("statut d'accès");

    await second.close();
    await moderator.close();
  });

  test("les refus de la source et les saisies invalides n'importent rien", async ({ browser }) => {
    const moderator = await openModerator(browser, new Set());
    const { page } = moderator;

    await importDoi(page, "pas-un-doi");
    await expect(alert(page)).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Ce DOI n'a pas la forme attendue");

    await importDoi(page, "10.5555/e2e.inconnu");
    await expect(alert(page)).toContainText("Crossref ne connaît pas ce DOI");

    await importDoi(page, "10.5555/e2e.dataset");
    await expect(alert(page)).toContainText("n'est pas encore pris en charge");

    // Réponse qui décrit un autre DOI, panne, redirection : rien n'est importé.
    for (const doi of ["10.5555/e2e.autre-doi", "10.5555/e2e.panne", "10.5555/e2e.redirection"]) {
      await importDoi(page, doi);
      await expect(alert(page), doi).toContainText("Rien n'a été importé");
      await expect(page).toHaveURL(/\/fr\/moderation\/import/);
    }

    // La source répond « trop de requêtes » : la pause qu'elle demande est
    // posée pour toute la plateforme. Elle est levée aussitôt, pour ne pas
    // retenir les imports des autres tests.
    try {
      await importDoi(page, "10.5555/e2e.trop-de-requetes");
      await expect(alert(page)).toContainText("La source demande une pause");
      expect(
        sqlValue(`select count(*) from private.connector_pauses where source_name = 'crossref' and paused_until between now() + interval '100 seconds' and now() + interval '121 seconds'`),
      ).toBe("1");
    } finally {
      sql(`delete from private.connector_pauses where source_name = 'crossref'`);
    }

    // Langue absente de la source : elle est demandée, puis reprise du formulaire.
    const doi = `10.5555/e2e.sans-langue.${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    await importDoi(page, doi);
    await expect(alert(page)).toContainText("n'indique pas la langue");
    await importDoi(page, doi, "Français");
    await expect(page).toHaveURL(/notice=imported/);
    await expect(page.getByRole("main")).toContainText("Français");

    await moderator.close();
  });

  test("la page d'import n'existe pas pour qui n'est pas modérateur", async ({ page }) => {
    const email = uniqueEmail("pas-moderateur");
    const password = strongPassword();
    completeProfileDirectly(await createConfirmedUser(email, password));
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/account/);

    const response = await page.goto("/fr/moderation/import");
    expect(response?.status()).toBe(404);
  });
});
