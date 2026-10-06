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

/** Deux fiches publiées et une en attente, créées directement en base. */
function seedCatalogue() {
  const token = `bib${Date.now()}${Math.round(Math.random() * 1e6)}`;
  const seed = { token, first: randomUUID(), second: randomUUID(), pending: randomUUID() };
  const row = (id: string, title: string, status: string) => `
    ('${id}', 'article', '${title} ${token}', array['Awa Diop'], 2022, 'fr', 'computer_science',
     'connector', 'e2e-seed', 'https://exemple.invalid/${token}/${id}', 'open_access', 'cc-by-4.0',
     '${status}', ${status === "published" ? "now(), now()" : "null, null"})`;

  sql(`
    insert into public.resources
      (id, type_code, title, authors, publication_year, language_code, program_code, source_kind, source_name,
       official_url, access_status, license_code, editorial_status, last_verified_at, published_at)
    values ${row(seed.first, "Graphes et parcours", "published")},
           ${row(seed.second, "Bases de données", "published")},
           ${row(seed.pending, "Proposition", "pending")}
  `);
  return seed;
}

async function signInOnboarded(page: Page, label: string) {
  const email = uniqueEmail(label);
  const password = strongPassword();
  completeProfileDirectly(await createConfirmedUser(email, password));
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
}

test.describe("bibliothèque personnelle", () => {
  // Parcours long : une vingtaine de pages et deux comptes.
  test.setTimeout(120_000);

  test("favoris et collections, de l'ajout au retrait", async ({ page, browser }) => {
    const seed = seedCatalogue();
    const collectionName = `Mémoire ${seed.token}`;
    await signInOnboarded(page, "bibliotheque");

    // --- Bibliothèque vide ---------------------------------------------------
    await page.getByRole("link", { name: "Ma bibliothèque" }).click();
    await expect(page).toHaveURL(/\/fr\/library/);
    await expect(page.getByRole("heading", { name: "Favoris (0)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Collections (0)" })).toBeVisible();

    // --- Favori depuis la fiche ----------------------------------------------
    await page.goto(`/fr/resources/${seed.first}`);
    await expect(page.getByTestId("favorite-state")).toContainText("n'est pas dans vos favoris");
    await page.getByRole("button", { name: "Ajouter aux favoris" }).click();
    await expect(page).toHaveURL(/notice=favorite-added/);
    await expect(status(page)).toContainText("ajoutée à vos favoris");
    await expect(page.getByTestId("favorite-state")).toContainText("est dans vos favoris");

    // --- Collection ----------------------------------------------------------
    await page.goto("/fr/library");
    await expect(page.getByRole("heading", { name: "Favoris (1)" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(`Graphes et parcours ${seed.token}`);

    // Nom vide : refus.
    await page.getByRole("button", { name: "Créer la collection" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");

    await page.getByLabel("Nom").fill(collectionName);
    await page.getByLabel("Description").fill("Sources du chapitre 2");
    await page.getByRole("button", { name: "Créer la collection" }).click();
    await expect(page).toHaveURL(/\/fr\/library\/collections\/[0-9a-f-]{36}\?notice=created/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(collectionName);
    await expect(page.getByRole("heading", { name: "Ressources (0)" })).toBeVisible();
    const collectionUrl = page.url().split("?")[0] ?? "";

    // Même nom une seconde fois : refus.
    await page.goto("/fr/library");
    await page.getByLabel("Nom").fill(collectionName.toUpperCase());
    await page.getByRole("button", { name: "Créer la collection" }).click();
    await expect(alert(page)).toContainText("déjà une collection de ce nom");

    // --- Ranger deux fiches --------------------------------------------------
    for (const id of [seed.first, seed.second]) {
      await page.goto(`/fr/resources/${id}`);
      await page.getByLabel("Collection", { exact: true }).selectOption({ label: collectionName });
      await page.getByRole("button", { name: "Ranger dans la collection" }).click();
      await expect(page).toHaveURL(/notice=item-added/);
      await expect(page.getByRole("main")).toContainText("Rangée dans :");
    }
    // Déjà rangée : la collection n'est plus proposée.
    await expect(page.getByRole("button", { name: "Ranger dans la collection" })).toHaveCount(0);

    await page.goto(collectionUrl);
    await expect(page.getByRole("heading", { name: "Ressources (2)" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(`Bases de données ${seed.token}`);

    // --- Fiche suspendue après coup -----------------------------------------
    sql(`update public.resources set editorial_status = 'suspended' where id = '${seed.second}'`);
    await page.goto(collectionUrl);
    await expect(page.getByRole("main")).not.toContainText(`Bases de données ${seed.token}`);
    const unavailable = page.getByTestId("unavailable-item");
    await expect(unavailable).toContainText("n'est plus disponible");
    await unavailable.getByRole("button", { name: "Retirer de la collection" }).click();
    await expect(page).toHaveURL(/notice=item-removed/);
    await expect(page.getByRole("heading", { name: "Ressources (1)" })).toBeVisible();
    await expect(page.getByTestId("unavailable-item")).toHaveCount(0);

    // --- Renommer ------------------------------------------------------------
    await page.getByLabel("Nom").fill(`${collectionName} bis`);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page).toHaveURL(/notice=updated/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${collectionName} bis`);

    // --- Cloisonnement : une autre personne ne voit rien ---------------------
    const context = await browser.newContext();
    const other = await context.newPage();
    await signInOnboarded(other, "bibliotheque-autre");
    expect((await other.goto(collectionUrl))?.status()).toBe(404);
    await other.goto("/fr/library");
    await expect(other.getByRole("heading", { name: "Favoris (0)" })).toBeVisible();
    await expect(other.getByRole("heading", { name: "Collections (0)" })).toBeVisible();
    await other.goto(`/fr/resources/${seed.first}`);
    await expect(other.getByTestId("favorite-state")).toContainText("n'est pas dans vos favoris");
    await context.close();

    // --- Retirer le favori, supprimer la collection --------------------------
    await page.goto("/fr/library");
    await page.getByRole("button", { name: "Retirer des favoris" }).click();
    await expect(page).toHaveURL(/notice=favorite-removed/);
    await expect(page.getByRole("heading", { name: "Favoris (0)" })).toBeVisible();

    await page.goto(collectionUrl);
    await page.getByRole("button", { name: "Supprimer cette collection" }).click();
    await expect(page).toHaveURL(/\/fr\/library\?notice=deleted/);
    await expect(page.getByRole("heading", { name: "Collections (0)" })).toBeVisible();
    expect((await page.goto(collectionUrl))?.status()).toBe(404);
    // La fiche, elle, est toujours au catalogue.
    expect((await page.goto(`/fr/resources/${seed.first}`))?.status()).toBe(200);
  });

  test("la bibliothèque exige une session", async ({ page }) => {
    await page.goto("/fr/library");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Flibrary/);
    await page.goto(`/fr/library/collections/${randomUUID()}`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
  });
});
