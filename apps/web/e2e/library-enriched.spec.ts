import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  signInThroughForm,
  sql,
  sqlValue,
  strongPassword,
  uniqueEmail,
} from "./support/auth";

// LOT 7 : notes et tags personnels, historique, export et import de références.

const status = (page: Page) => page.getByRole("main").getByRole("status");

function seedCatalogue() {
  const token = `lot7${Date.now()}${Math.round(Math.random() * 1e6)}`;
  const seed = { token, first: randomUUID(), second: randomUUID() };
  const row = (id: string, title: string) => `
    ('${id}', 'article', '${title} ${token}', array['Diop, Awa'], 2022, 'fr', 'computer_science',
     'connector', 'e2e-seed', 'https://exemple.invalid/${token}/${id}', 'open_access', 'cc-by-4.0',
     'published', now(), now())`;
  sql(`
    insert into public.resources
      (id, type_code, title, authors, publication_year, language_code, program_code, source_kind, source_name,
       official_url, access_status, license_code, editorial_status, last_verified_at, published_at)
    values ${row(seed.first, "Graphes")}, ${row(seed.second, "Réseaux")}
  `);
  return seed;
}

async function signInOnboarded(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return id;
}

test.describe("bibliothèque enrichie", () => {
  test.setTimeout(120_000);

  test("historique, note, tag, filtre et export", async ({ page, browser }) => {
    const seed = seedCatalogue();
    await signInOnboarded(page, "lot7");

    // --- Navigation venue d'un autre site : non enregistrée ---------------------
    const crossSiteView = await page.request.get(`/fr/resources/${seed.first}`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(crossSiteView.status()).toBe(200);
    await page.goto("/fr/library/history");
    await expect(page.getByRole("main")).toContainText("Aucune consultation enregistrée.");

    // --- Consultation enregistrée, favoris ------------------------------------
    for (const id of [seed.first, seed.second]) {
      await page.goto(`/fr/resources/${id}`);
      await page.getByRole("button", { name: "Ajouter aux favoris" }).click();
      await expect(page).toHaveURL(/notice=favorite-added/);
    }
    await page.goto("/fr/library/history");
    await expect(page.getByTestId("history-list")).toContainText(`Graphes ${seed.token}`);
    await expect(page.getByTestId("history-list")).toContainText(`Réseaux ${seed.token}`);

    // --- Note et tag sur un favori -------------------------------------------
    await page.goto("/fr/library");
    const first = page.getByRole("listitem").filter({ hasText: `Graphes ${seed.token}` });
    await first.getByText("Note et tags").click();
    await first.getByLabel("Note privée").fill("=1+1 à relire");
    await first.getByRole("button", { name: "Enregistrer la note" }).click();
    await expect(page).toHaveURL(/notice=note-saved/);
    await expect(status(page)).toHaveText("La note est enregistrée.");

    const again = page.getByRole("listitem").filter({ hasText: `Graphes ${seed.token}` });
    await expect(again.getByTestId("item-note")).toContainText("=1+1 à relire");
    await again.getByText("Note et tags").click();
    await again.getByLabel("Nouveau tag").fill("Méthode, mixte");
    await again.getByRole("button", { name: "Ajouter le tag" }).click();
    await expect(again.getByRole("alert")).toBeVisible();
    await again.getByLabel("Nouveau tag").fill(`Terrain ${seed.token.slice(-6)}`);
    await again.getByRole("button", { name: "Ajouter le tag" }).click();
    await expect(page).toHaveURL(/notice=tag-added/);

    // --- Filtre par tag ---------------------------------------------------------
    const tag = `Terrain ${seed.token.slice(-6)}`;
    await page.getByRole("navigation", { name: "Filtrer par tag" }).getByRole("link", { name: `${tag} (1)` }).click();
    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByRole("main")).toContainText(`Graphes ${seed.token}`);
    await expect(page.getByRole("main")).not.toContainText(`Réseaux ${seed.token}`);

    // --- Export ---------------------------------------------------------------
    const csv = await page.request.get("/fr/library/export/csv");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-disposition"]).toBe('attachment; filename="eduscholar-favoris.csv"');
    expect(csv.headers()["cache-control"]).toContain("no-store");
    const csvText = await csv.text();
    expect(csvText).toContain(`"'=1+1 à relire"`);
    expect(csvText).toContain(`"${tag}"`);

    const bib = await page.request.get("/fr/library/export/bib");
    expect(bib.headers()["content-type"]).toContain("application/x-bibtex");
    expect(await bib.text()).toContain(`title = {Graphes ${seed.token}}`);
    const ris = await page.request.get("/fr/library/export/ris");
    expect(await ris.text()).toContain(`TI  - Réseaux ${seed.token}`);
    const apa = await page.request.get("/fr/library/export/apa?lang=fr");
    expect(await apa.text()).toContain(`Diop, A. (2022). Graphes ${seed.token}.`);
    expect((await page.request.get("/fr/library/export/docx")).status()).toBe(404);
    // Déclenché depuis un autre site : refusé.
    const crossSite = await page.request.get("/fr/library/export/bib", { headers: { "sec-fetch-site": "cross-site" } });
    expect(crossSite.status()).toBe(404);

    // --- Collection d'un autre compte : même réponse qu'une collection inexistante
    await page.goto("/fr/library");
    await page.getByLabel("Nom").fill(`Collection ${seed.token}`);
    await page.getByRole("button", { name: "Créer la collection" }).click();
    await expect(page).toHaveURL(/\/fr\/library\/collections\/[0-9a-f-]{36}/);
    const collectionId = /collections\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signInOnboarded(otherPage, "lot7-autre");
    for (const target of [collectionId, randomUUID()]) {
      const response = await otherPage.request.get(`/fr/library/export/bib?collection=${target}`);
      expect(response.status()).toBe(404);
    }
    await otherPage.goto("/fr/library/history");
    await expect(otherPage.getByRole("main")).toContainText("Aucune consultation enregistrée.");
    await other.close();

    // Sans session : rien.
    const anonymous = await browser.newContext();
    expect((await anonymous.request.get("/fr/library/export/csv")).status()).toBe(404);
    await anonymous.close();

    // --- Désactivation de l'historique ----------------------------------------
    await page.goto("/fr/library/history");
    await page.getByRole("button", { name: "Désactiver et effacer l'historique" }).click();
    await expect(page).toHaveURL(/notice=disabled/);
    await expect(page.getByTestId("history-state")).toHaveText("L'historique est désactivé : rien n'est enregistré.");
    await page.goto(`/fr/resources/${seed.first}`);
    await page.goto("/fr/library/history");
    await expect(page.getByRole("main")).toContainText("Aucune consultation enregistrée.");
    await page.getByRole("button", { name: "Activer l'historique" }).click();
    await expect(page).toHaveURL(/notice=enabled/);
  });

  test("import BibTeX vers les sources d'un projet, avec aperçu et rapport", async ({ page }) => {
    const userId = await signInOnboarded(page, "lot7-import");
    const projectId = randomUUID();
    const token = `imp${Date.now()}`;
    sql(`insert into public.research_projects (id, owner_id, title) values ('${projectId}', '${userId}', 'Projet ${token}')`);

    const bibtex = [
      `@article{a, author = {Ndiaye, Fatou and Ba, Ousmane}, title = {L'{\\'e}cole ${token}}, journal = {Revue}, year = 2021, doi = {10.1234/${token}}}`,
      `@book{b, title = {Livre ${token}}, publisher = {Presses}, year = {2019}}`,
      `@misc{c, author = {Sans titre}}`,
      `@article{d, title = {L'école ${token}}, year = 2021}`,
    ].join("\n");

    await page.goto(`/fr/projects/${projectId}/sources`);
    await page.getByRole("link", { name: "Importer des références (BibTeX, RIS)" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/sources/import`));
    await page.getByLabel("Ou collez les références").fill(bibtex);
    await page.getByRole("button", { name: "Voir l'aperçu" }).click();

    await expect(page.getByTestId("import-preview").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("import-preview")).toContainText(`L'école ${token}`);
    await expect(page.getByTestId("import-rejected")).toContainText("titre manquant");
    await expect(page.getByTestId("import-rejected")).toContainText("doublon dans le fichier");
    // L'aperçu n'a rien écrit.
    expect(sqlValue(`select count(*) from public.project_sources where project_id = '${projectId}'`)).toBe("0");

    await page.getByRole("button", { name: "Importer 2 références" }).click();
    await expect(page.getByTestId("import-done")).toHaveText("2 références importées dans les sources du projet.");
    expect(sqlValue(`select count(*) from public.project_sources where project_id = '${projectId}' and resource_id is null`)).toBe("2");
    expect(sqlValue(`select count(*) from public.resources where title like '%${token}%'`)).toBe("0");

    // Fichier de 1,01 Mo : refusé par l'application, avec son message.
    await page.goto(`/fr/projects/${projectId}/sources/import`);
    await page.getByLabel("Fichier BibTeX ou RIS").setInputFiles({
      name: "trop-gros.bib",
      mimeType: "text/plain",
      buffer: Buffer.from(`@misc{a, title = {${"x".repeat(1_010_000)}}}`),
    });
    await page.getByRole("button", { name: "Voir l'aperçu" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Le fichier dépasse un mégaoctet.");

    // Le même fichier une seconde fois : tout est déjà là.
    await page.goto(`/fr/projects/${projectId}/sources/import`);
    await page.getByLabel("Ou collez les références").fill(bibtex);
    await page.getByRole("button", { name: "Voir l'aperçu" }).click();
    await page.getByRole("button", { name: "Importer 2 références" }).click();
    await expect(page.getByTestId("import-done")).toHaveText("Aucune référence importée.");
    await expect(page.getByTestId("import-rejected")).toContainText("déjà dans les sources du projet");

    // Projet d'un autre ou inexistant : page introuvable.
    const response = await page.goto(`/fr/projects/${randomUUID()}/sources/import`);
    expect(response?.status()).toBe(404);
  });
});
