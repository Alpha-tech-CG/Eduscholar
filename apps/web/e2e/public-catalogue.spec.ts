import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { sql } from "./support/auth";

// Catalogue public, sans compte (ADR-0014) : accueil, recherche, fiche
// indexable, plan du site et robots.txt.

type Seed = {
  token: string;
  published: string;
  institutional: string;
  pending: string;
  suspended: string;
  reserved: string;
};

/**
 * Fiches créées directement en base, avec un mot unique. Publiées à l'instant :
 * aucune date future, qui fausserait l'ordre des autres tests.
 */
function seedPublicCatalogue(): Seed {
  const token = `zzpub${Date.now()}${Math.round(Math.random() * 1e6)}`;
  const seed: Seed = {
    token,
    published: randomUUID(),
    institutional: randomUUID(),
    pending: randomUUID(),
    suspended: randomUUID(),
    reserved: randomUUID(),
  };
  const organization = randomUUID();
  const columns = `(id, type_code, title, abstract, authors, institution_name, publication_year, language_code,
    country_code, program_code, level_codes, tags, doi, official_url, access_status, license_code, source_kind,
    source_name, editorial_status, visibility, organization_id, last_verified_at, published_at)`;

  sql(`
    insert into public.organizations (id, name, slug, status)
      values ('${organization}', 'Université ${token}', 'univ-${token}', 'verified');
    insert into public.resources ${columns} values
      ('${seed.published}', 'article', 'Réseaux ruraux ${token}', 'Étude des réseaux ruraux <b>${token}</b>.',
       array['Awa Diop'], null, 2024, 'fr', 'SN', 'computer_science', array['bachelor_3'], array['réseaux'],
       '10.5555/${token}', 'https://exemple.invalid/${token}/p', 'open_access', 'cc-by-4.0', 'connector',
       'e2e-public', 'published', 'public', null, now(), now()),
      ('${seed.institutional}', 'thesis', 'Thèse institutionnelle ${token}', null,
       '{}', 'Université ${token}', 2023, 'fr', 'SN', 'computer_science', '{}', '{}',
       null, 'https://exemple.invalid/${token}/i', 'open_access', 'cc-by-4.0', 'organization',
       'Université ${token}', 'published', 'public', '${organization}', now(), now()),
      ('${seed.pending}', 'article', 'En attente ${token}', null,
       array['Awa Diop'], null, 2024, 'fr', 'SN', 'computer_science', '{}', '{}',
       null, 'https://exemple.invalid/${token}/a', 'open_access', 'cc-by-4.0', 'connector',
       'e2e-public', 'pending', 'public', null, null, null),
      ('${seed.suspended}', 'article', 'Suspendue ${token}', null,
       array['Awa Diop'], null, 2024, 'fr', 'SN', 'computer_science', '{}', '{}',
       null, 'https://exemple.invalid/${token}/s', 'open_access', 'cc-by-4.0', 'connector',
       'e2e-public', 'published', 'public', null, now(), now()),
      ('${seed.reserved}', 'article', 'Réservée ${token}', null,
       array['Awa Diop'], null, 2024, 'fr', 'SN', 'computer_science', '{}', '{}',
       null, 'https://exemple.invalid/${token}/r', 'open_access', 'cc-by-4.0', 'organization',
       'Université ${token}', 'published', 'organization', '${organization}', now(), now());
    update public.resources set editorial_status = 'suspended' where id = '${seed.suspended}';
  `);
  return seed;
}

test.describe("catalogue public, sans compte", () => {
  test("l'accueil cherche, montre les récentes et les institutions vérifiées", async ({ page }) => {
    const seed = seedPublicCatalogue();
    await page.goto("/fr");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("EduScholar");
    await expect(page.getByRole("heading", { level: 2, name: "Rechercher dans le catalogue" })).toBeVisible();
    for (const label of ["Mots recherchés", "Pays", "Niveau", "Filière"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }

    // Les récentes : six au plus. D'autres tests publient en parallèle, la
    // fiche n'y est donc pas forcément ; les fiches cachées, jamais.
    const recent = page.getByTestId("home-recent").getByTestId("resource-card");
    expect(await recent.count()).toBeGreaterThan(0);
    expect(await recent.count()).toBeLessThanOrEqual(6);
    await expect(page.getByRole("main")).not.toContainText(`En attente ${seed.token}`);
    await expect(page.getByRole("main")).not.toContainText(`Suspendue ${seed.token}`);
    await expect(page.getByRole("main")).not.toContainText(`Réservée ${seed.token}`);

    const institutional = page.getByTestId("home-institutional");
    const card = institutional.getByRole("listitem").filter({ hasText: `Thèse institutionnelle ${seed.token}` });
    await expect(card.getByTestId("verified-institution")).toHaveText("Institution vérifiée");

    // La recherche depuis l'accueil, filtrée par pays.
    await page.getByLabel("Mots recherchés").fill(seed.token);
    await page.getByLabel("Pays", { exact: true }).selectOption("SN");
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/search\\?q=${seed.token}&country=SN`));
    await expect(page.getByRole("heading", { name: "2 résultats" })).toBeVisible();
    const results = page.getByRole("main").getByTestId("resource-card");
    await expect(results.filter({ hasText: `Réseaux ruraux ${seed.token}` })).toHaveCount(1);
    await expect(results.filter({ hasText: `Thèse institutionnelle ${seed.token}` })).toHaveCount(1);

    // Un autre pays : rien.
    await page.goto(`/fr/search?q=${seed.token}&country=FR`);
    await expect(page.getByRole("heading", { name: "Aucun résultat" })).toBeVisible();
  });

  test("la fiche publique est indexable et décrite", async ({ page }) => {
    const seed = seedPublicCatalogue();
    const response = await page.goto(`/fr/resources/${seed.published}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Réseaux ruraux ${seed.token}`);
    await expect(page).toHaveTitle(new RegExp(`Réseaux ruraux ${seed.token}`));
    // Le texte de la fiche est rendu en texte, jamais en HTML.
    await expect(page.getByRole("main")).toContainText(`<b>${seed.token}</b>`);

    const head = page.locator("head");
    await expect(head.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
    await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/fr/resources/${seed.published}$`),
    );
    for (const lang of ["fr", "en", "pt", "x-default"]) {
      await expect(head.locator(`link[rel="alternate"][hreflang="${lang}"]`)).toHaveCount(1);
    }
    await expect(head.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      `Réseaux ruraux ${seed.token}`,
    );

    const script = page.locator('script[type="application/ld+json"]');
    await expect(script).toHaveCount(1);
    const csp = response?.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    // Le navigateur masque l'attribut nonce une fois la page chargée : on lit le HTML servi.
    const html = (await response?.text()) ?? "";
    expect(html).toContain(`nonce="${nonce}"`);
    const data = JSON.parse((await script.textContent()) ?? "{}");
    expect(data).toMatchObject({
      "@type": "ScholarlyArticle",
      name: `Réseaux ruraux ${seed.token}`,
      identifier: { value: `10.5555/${seed.token}` },
      isAccessibleForFree: true,
    });

    // Les actions des comptes ne sont pas offertes au visiteur.
    await expect(page.getByRole("button", { name: "Envoyer le signalement" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Se connecter" }).last()).toHaveAttribute(
      "href",
      new RegExp(`/fr/sign-in\\?next=%2Fresources%2F${seed.published}`),
    );
    // Rien qui identifie le contributeur ou l'organisation dans la page.
    expect(html).not.toContain("submitted_by");
    expect(html).not.toContain("organization_id");

    // En anglais : même fiche, libellés traduits.
    await page.goto(`/en/resources/${seed.published}`);
    await expect(page.getByRole("heading", { name: "Save or cite this resource" })).toBeVisible();
  });

  test("une fiche cachée répond introuvable, et ne laisse pas son titre", async ({ page }) => {
    const seed = seedPublicCatalogue();
    for (const id of [seed.pending, seed.suspended, seed.reserved, randomUUID(), "pas-un-identifiant"]) {
      const response = await page.goto(`/fr/resources/${id}`);
      expect(response?.status(), id).toBe(404);
      expect(await response?.text(), id).not.toContain(seed.token);
    }
  });

  test("plan du site et robots.txt", async ({ request }) => {
    const seed = seedPublicCatalogue();
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    // La liste des fiches est gardée cinq minutes : une fiche créée à l'instant
    // n'y est pas forcément. Chaque fiche listée l'est dans les trois langues.
    const ids = [...xml.matchAll(/\/fr\/resources\/([0-9a-f-]{36})<\/loc>/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const locale of ["en", "pt"]) {
      expect(xml).toContain(`/${locale}/resources/${ids[0]}</loc>`);
    }
    expect(xml).toContain("/fr/help</loc>");
    expect(xml).toContain('hreflang="pt"');
    for (const hidden of [seed.pending, seed.suspended, seed.reserved]) expect(xml).not.toContain(hidden);
    expect(xml).not.toMatch(/\/(fr|en|pt)\/(account|admin|moderation|projects|library)/);

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const text = await robots.text();
    for (const path of ["/api/", "/fr/account", "/en/admin", "/pt/moderation", "/fr/projects", "/fr/library"]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
    expect(text).toMatch(/Sitemap: \S+\/sitemap\.xml/);
  });

  test("l'accueil tient sur un petit écran", async ({ page }) => {
    seedPublicCatalogue();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/fr");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
