import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  makeModerator,
  signInThroughForm,
  sql,
  strongPassword,
  TEST_FACTOR_SECRET,
  uniqueEmail,
} from "./support/auth";
import { freshTotp } from "./support/totp";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

type Seed = { token: string; article: string; book: string; pending: string };

/**
 * Trois fiches créées directement en base : un article et un livre publiés, et
 * une proposition en attente. Le jeton, unique, isole ce test des autres.
 */
function seedCatalogue(): Seed {
  const token = `e2e${Date.now()}${Math.round(Math.random() * 1e6)}`;
  const seed = { token, article: randomUUID(), book: randomUUID(), pending: randomUUID() };
  const common = `'fr', 'computer_science', 'connector', 'e2e-seed'`;

  sql(`
    insert into public.resources
      (id, type_code, title, authors, publication_year, language_code, program_code, source_kind, source_name,
       level_codes, subject_codes, tags, official_url, access_status, license_code,
       editorial_status, last_verified_at, published_at)
    values
      ('${seed.article}', 'article', 'Sécurité des réseaux ${token}', array['Awa Diop'], 2023, ${common},
       array['bachelor_3'], array['algorithms'], array['réseaux'],
       'https://exemple.invalid/${token}/article', 'open_access', 'cc-by-4.0', 'published', now(), now()),
      ('${seed.book}', 'book', 'Manuel de compilation ${token}', array['Kofi Mensah'], 2019, ${common},
       '{}', '{}', '{}',
       'https://exemple.invalid/${token}/livre', 'paid', 'all-rights-reserved', 'published', now(), now()),
      ('${seed.pending}', 'article', 'Proposition en attente ${token}', array['Awa Diop'], 2024, ${common},
       '{}', '{}', '{}',
       'https://exemple.invalid/${token}/attente', 'open_access', 'cc-by-4.0', 'pending', null, null)
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

async function search(page: Page, words: string) {
  await page.getByLabel("Mots recherchés").fill(words);
  await page.getByRole("button", { name: "Rechercher" }).click();
}

test.describe("recherche dans le catalogue", () => {
  test("recherche, filtres, fiche et signalement", async ({ page }) => {
    const seed = seedCatalogue();
    await signInOnboarded(page, "recherche");

    await page.getByRole("link", { name: "Rechercher une ressource" }).click();
    await expect(page).toHaveURL(/\/fr\/search/);

    // Les deux fiches publiées, pas la proposition en attente.
    await search(page, seed.token);
    await expect(page.getByRole("heading", { name: "2 résultats" })).toBeVisible();
    const results = page.getByRole("main").getByRole("listitem");
    await expect(results.filter({ hasText: "Sécurité des réseaux" })).toHaveCount(1);
    await expect(results.filter({ hasText: "Manuel de compilation" })).toHaveCount(1);
    await expect(page.getByRole("main")).not.toContainText("Proposition en attente");
    // Origine et statut d'accès sont affichés dès la liste.
    await expect(results.filter({ hasText: "Sécurité des réseaux" })).toContainText("Accès ouvert");
    await expect(results.filter({ hasText: "Sécurité des réseaux" })).toContainText(
      "Origine : e2e-seed",
    );
    await expect(results.filter({ hasText: "Manuel de compilation" })).toContainText("Payant");

    // Sans accents, sans casse, par début de mot.
    await search(page, `SECURITE resea ${seed.token}`);
    await expect(page.getByRole("heading", { name: "1 résultat" })).toBeVisible();
    await expect(results).toContainText(["Sécurité des réseaux"]);
    // Par auteur.
    await search(page, `mensah ${seed.token}`);
    await expect(results).toContainText(["Manuel de compilation"]);
    // Tous les mots sont exigés.
    await search(page, `${seed.token} motabsent`);
    await expect(page.getByRole("heading", { name: "Aucun résultat" })).toBeVisible();

    // Filtres : type, statut d'accès, niveau, matière.
    await search(page, seed.token);
    await page.getByLabel("Type de ressource").selectOption({ label: "Livre" });
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page).toHaveURL(/type=book/);
    await expect(page.getByRole("heading", { name: "1 résultat" })).toBeVisible();
    await expect(results).toContainText(["Manuel de compilation"]);

    await page.getByLabel("Type de ressource").selectOption({ label: "Tous" });
    await page.getByLabel("Statut d'accès").selectOption({ label: "Accès ouvert" });
    await page.getByLabel("Matière").selectOption({ label: "Algorithmique" });
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page.getByRole("heading", { name: "1 résultat" })).toBeVisible();
    await expect(results).toContainText(["Sécurité des réseaux"]);

    await page.getByLabel("Statut d'accès").selectOption({ label: "Payant" });
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page.getByRole("heading", { name: "Aucun résultat" })).toBeVisible();

    // Un filtre inventé dans l'adresse est ignoré, pas transmis à la base.
    await page.goto(`/fr/search?q=${seed.token}&type=' or 1=1 --&access=removed`);
    await expect(page.getByRole("heading", { name: "2 résultats" })).toBeVisible();

    // --- Fiche ---------------------------------------------------------------
    await results.filter({ hasText: "Sécurité des réseaux" }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/fr/resources/${seed.article}`));
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `Sécurité des réseaux ${seed.token}`,
    );
    await expect(main).toContainText("Awa Diop");
    await expect(main).toContainText("Accès ouvert");
    await expect(main).toContainText("CC BY 4.0");
    await expect(main).toContainText("e2e-seed");
    await expect(main).toContainText("n'héberge pas ce document");
    const link = main.getByRole("link", { name: `https://exemple.invalid/${seed.token}/article` });
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);

    // --- Signalement ---------------------------------------------------------
    await page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(alert(page)).toBeVisible();
    await page.getByLabel("Motif").selectOption({ label: "Lien cassé" });
    await page.getByLabel("Précisions").fill("Le lien renvoie une erreur 404.");
    await page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(page).toHaveURL(/notice=reported/);
    await expect(status(page)).toContainText("votre signalement a été transmis");

    // Un seul signalement ouvert par personne et par fiche.
    await page.getByLabel("Motif").selectOption({ label: "Lien cassé" });
    await page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(alert(page)).toContainText("déjà signalé");

    // --- Une fiche non publiée n'a pas de page -------------------------------
    const response = await page.goto(`/fr/resources/${seed.pending}`);
    expect(response?.status()).toBe(404);
    expect((await page.goto("/fr/resources/pas-un-identifiant"))?.status()).toBe(404);
  });

  test("une modératrice ne voit pas les fiches non publiées par la recherche", async ({
    page,
  }) => {
    const seed = seedCatalogue();
    const email = uniqueEmail("recherche-moderation");
    const password = strongPassword();
    const id = await createConfirmedUser(email, password);
    completeProfileDirectly(id);
    makeModerator(id);
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, new Set()));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/fr\/account/);

    // Elle lit la proposition en modération, mais ni la recherche ni la page
    // publique ne la montrent.
    expect((await page.goto(`/fr/moderation/${seed.pending}`))?.status()).toBe(200);
    const response = await page.goto(`/fr/search?q=${seed.token}`);
    expect(response?.headers()["cache-control"] ?? "").toMatch(/no-store|private/);
    await expect(page.getByRole("heading", { name: "2 résultats" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Proposition en attente");
    expect((await page.goto(`/fr/resources/${seed.pending}`))?.status()).toBe(404);

    // Une fiche suspendue disparaît aussitôt de la recherche et n'a plus de page.
    sql(`update public.resources set editorial_status = 'suspended' where id = '${seed.book}'`);
    await page.goto(`/fr/search?q=${seed.token}`);
    await expect(page.getByRole("heading", { name: "1 résultat" })).toBeVisible();
    expect((await page.goto(`/fr/resources/${seed.book}`))?.status()).toBe(404);

    // Une page au-delà de la dernière ramène aux résultats, pas à « aucun résultat ».
    await page.goto(`/fr/search?q=${seed.token}&page=500`);
    await expect(page.getByRole("heading", { name: "1 résultat" })).toBeVisible();
  });

  test("sans session, la recherche et les fiches sont publiques (ADR-0014)", async ({ page }) => {
    // Le détail est couvert par public-catalogue.spec.ts.
    await page.goto("/fr/search?q=test");
    await expect(page).toHaveURL(/\/fr\/search\?q=test/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rechercher dans le catalogue");
    expect((await page.goto(`/fr/resources/${randomUUID()}`))?.status()).toBe(404);
  });

  test("en anglais, les libellés suivent la langue", async ({ page }) => {
    const seed = seedCatalogue();
    await signInOnboarded(page, "search-en");
    await page.goto(`/en/search?q=${seed.token}`);
    await expect(page.getByRole("heading", { name: "2 results" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Open access");
    await expect(page.getByRole("main")).toContainText("Origin: e2e-seed");
  });
});
