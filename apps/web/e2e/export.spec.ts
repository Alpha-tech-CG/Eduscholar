import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
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

const output = join(process.cwd(), "test-results", "exports");

type Account = { id: string; email: string; password: string };

async function signInOnboarded(page: Page, label: string): Promise<Account> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return { id, email, password };
}

/** Demande la copie de ses données par le formulaire, et rend le fichier lu. */
async function downloadData(page: Page, password: string) {
  await page.goto("/fr/account/export");
  await page.getByLabel("Mot de passe actuel").fill(password);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Télécharger le fichier" }).click(),
  ]);
  mkdirSync(output, { recursive: true });
  const path = join(output, `donnees-${randomUUID()}.json`);
  await download.saveAs(path);
  return { download, data: JSON.parse(readFileSync(path, "utf8")) };
}

/** Un projet complet : fiche, deux sources, trois sections, une citation. */
function seedProject(ownerId: string) {
  const projectId = randomUUID();
  const sectionId = randomUUID();
  const sourceId = randomUUID();
  const token = `exp${Date.now()}${Math.round(Math.random() * 1e6)}`;
  sql(`
    insert into public.research_projects (id, owner_id, title, supervisor_name)
      values ('${projectId}', '${ownerId}', 'Mémoire <b>${token}</b>', 'Pr Ndiaye');
    insert into public.project_sources (id, project_id, source_type, title, authors, publication_year, container_title, volume, publisher) values
      ('${sourceId}', '${projectId}', 'article', 'Réseaux profonds', array['Diop, Awa'], 2021, 'Revue de test', '4', null),
      (gen_random_uuid(), '${projectId}', 'book', 'Manuel de test', array['Mensah, Kofi'], 2019, null, null, 'Presses');
    insert into public.thesis_sections (id, project_id, position, level, title, body) values
      ('${sectionId}', '${projectId}', 1, 1, 'Introduction',
       E'Premier paragraphe.\\nMême paragraphe.\\n\\nSecond paragraphe avec <script>alert(1)</script>.'),
      (gen_random_uuid(), '${projectId}', 2, 2, 'Contexte', null),
      (gen_random_uuid(), '${projectId}', 3, 1, 'Conclusion', '# Pas un titre');
    insert into public.section_citations (section_id, source_id, pages) values ('${sectionId}', '${sourceId}', 'p. 12-14');
  `);
  return { projectId, token };
}


test.describe("export d'un projet", () => {
  test.setTimeout(120_000);

  test("document imprimable, DOCX, Markdown et cloisonnement", async ({ page, browser }, testInfo) => {
    const { id: ownerId } = await signInOnboarded(page, "export");
    const { projectId, token } = seedProject(ownerId);

    await page.goto(`/fr/projects/${projectId}`);
    await page.getByRole("link", { name: "Voir et exporter le mémoire" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/document`));

    // --- Document ------------------------------------------------------------
    const document = page.getByTestId("document");
    await expect(page.getByTestId("document-title")).toHaveText(`Mémoire <b>${token}</b>`);
    await expect(document).toContainText("Sous la direction de Pr Ndiaye");
    await expect(document.getByRole("navigation").getByRole("link")).toHaveText([
      "1 Introduction",
      "1.1 Contexte",
      "2 Conclusion",
    ]);
    await expect(document.getByRole("heading", { name: "1 Introduction" })).toBeVisible();
    await expect(document).toContainText("Second paragraphe avec <script>alert(1)</script>.");
    await expect(document.locator("script")).toHaveCount(0);
    await expect(document.getByTestId("section-cited")).toHaveText(
      "Sources citées dans cette section : Diop, A. (2021), p. 12-14",
    );
    await expect(document.getByTestId("document-reference")).toHaveText([
      "Diop, A. (2021). Réseaux profonds. Revue de test, 4.",
      "Mensah, K. (2019). Manuel de test. Presses.",
    ]);

    // À l'impression, le menu et les commandes disparaissent ; le document reste.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("button", { name: "Imprimer ou enregistrer en PDF" })).toBeHidden();
    await expect(page.getByTestId("document-title")).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    // --- Téléchargements -----------------------------------------------------
    mkdirSync(output, { recursive: true });
    const [docx] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Télécharger en Word (.docx)" }).click(),
    ]);
    expect(docx.suggestedFilename()).toBe(`memoire-Memoire-b-${token}-b.docx`);
    const docxPath = join(output, `${testInfo.project.name}.docx`);
    await docx.saveAs(docxPath);
    const bytes = readFileSync(docxPath);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    expect(bytes.length).toBeGreaterThan(1500);

    const [markdown] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Télécharger en Markdown (.md)" }).click(),
    ]);
    expect(markdown.suggestedFilename()).toBe(`memoire-Memoire-b-${token}-b.md`);
    const markdownPath = join(output, `${testInfo.project.name}.md`);
    await markdown.saveAs(markdownPath);
    const text = readFileSync(markdownPath, "utf8");
    expect(text).toContain(`# Mémoire \\<b\\>${token}\\</b\\>`);
    expect(text).toContain("## 1 Introduction");
    expect(text).toContain("### 1.1 Contexte");
    expect(text).toContain("Premier paragraphe.  \nMême paragraphe.");
    expect(text).toContain("\\# Pas un titre");
    expect(text).toContain("## Références");
    expect(text).toContain("Diop, A. (2021). Réseaux profonds. *Revue de test*, *4*.");
    expect(text).not.toContain("<script>");

    // En-têtes : pièce jointe, jamais mise en cache.
    const response = await page.request.get(`/fr/projects/${projectId}/export/md?lang=en`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await response.text()).toContain("## References");

    // Format inconnu.
    expect((await page.request.get(`/fr/projects/${projectId}/export/exe`)).status()).toBe(404);

    // Une requête déclenchée par un autre site est refusée, session comprise.
    for (const site of ["cross-site", "same-site"]) {
      const forged = await page.request.get(`/fr/projects/${projectId}/export/md`, {
        headers: { "sec-fetch-site": site },
      });
      expect(forged.status(), site).toBe(404);
      expect(forged.headers()["cache-control"]).toContain("no-store");
    }

    // Projet supprimé : plus de document, plus d'export.
    const deleted = seedProject(ownerId).projectId;
    sql(`update public.research_projects set deleted_at = now() where id = '${deleted}'`);
    expect((await page.request.get(`/fr/projects/${deleted}/export/docx`)).status()).toBe(404);
    expect((await page.goto(`/fr/projects/${deleted}/document`))?.status()).toBe(404);
    await page.goto(`/fr/projects/${projectId}/document`);

    // --- En anglais ----------------------------------------------------------
    await page.getByRole("link", { name: "Anglais" }).click();
    await expect(document).toContainText("Supervised by Pr Ndiaye");
    await expect(document.getByRole("heading", { name: "References" })).toBeVisible();

    // --- Cloisonnement : autre compte, visiteur ------------------------------
    const context = await browser.newContext();
    const other = await context.newPage();
    await signInOnboarded(other, "export-autre");
    expect((await other.goto(`/fr/projects/${projectId}/document`))?.status()).toBe(404);
    for (const format of ["docx", "md"]) {
      expect((await other.request.get(`/fr/projects/${projectId}/export/${format}`)).status()).toBe(404);
    }
    await context.close();

    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    expect((await visitor.request.get(`/fr/projects/${projectId}/export/docx`)).status()).toBe(404);
    await visitor.goto("/fr/account/export");
    await expect(visitor).toHaveURL(/\/fr\/sign-in/);
    await anonymous.close();
  });

  test("export de ses données personnelles", async ({ page, browser }) => {
    const owner = await signInOnboarded(page, "donnees");
    const { projectId, token } = seedProject(owner.id);

    await page.getByRole("link", { name: "Télécharger mes données" }).click();
    await expect(page).toHaveURL(/\/fr\/account\/export/);

    // Mot de passe redemandé : une session ouverte ne suffit pas.
    await page.getByLabel("Mot de passe actuel").fill("MauvaisMotDePasse1");
    await page.getByRole("button", { name: "Télécharger le fichier" }).click();
    await expect(page).toHaveURL(/\/fr\/account\/export\?error=password/);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Mot de passe incorrect.");

    const { download, data } = await downloadData(page, owner.password);
    expect(download.suggestedFilename()).toBe("eduscholar-mes-donnees.json");

    expect(data.format).toBe("eduscholar-personal-data");
    expect(data.account).toMatchObject({ id: owner.id, email: owner.email });
    expect(data.profile).toMatchObject({ country_code: "SN", program_code: "computer_science" });
    expect(data.research.projects).toHaveLength(1);
    expect(data.research.projects[0]).toMatchObject({ id: projectId, title: `Mémoire <b>${token}</b>` });
    expect(data.research.sources).toHaveLength(2);
    expect(data.research.sections).toHaveLength(3);
    expect(data.research.section_citations).toEqual([expect.objectContaining({ pages: "p. 12-14" })]);
    expect(data.not_included).not.toContain("deleted_projects_pending_purge");
    expect(data.version).toBe(2);
    expect(Array.isArray(data.research.deleted_projects_pending_purge)).toBe(true);
    expect(Array.isArray(data.account_events)).toBe(true);
    // Rien d'interne ni d'autrui : pas de colonne de propriété, pas de note de modération.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("owner_id");
    expect(serialized).not.toContain("moderation_notes");
    expect(serialized).not.toContain("submitted_by");
    expect(serialized).not.toContain(owner.password);

    // L'export laisse une trace de sécurité, sans contenu.
    const trace = sqlValue(
      `select count(*) from public.audit_logs where action = 'account.data_exported' and actor_id = '${owner.id}'`,
    );
    expect(trace).toBe("1");

    // Requêtes forgées : autre origine, ou sans mot de passe.
    const forged = await page.request.post("/fr/account/export/download", {
      headers: { origin: "https://evil.example" },
      form: { password: owner.password },
    });
    expect(forged.status()).toBe(404);
    const missing = await page.request.post("/fr/account/export/download", {
      headers: { origin: new URL(page.url()).origin },
      form: { password: "" },
      maxRedirects: 0,
    });
    expect(missing.status()).toBe(303);
    expect(missing.headers().location).toContain("error=password");
    // L'ancienne adresse en GET ne rend aucun fichier.
    const viaGet = await page.request.get("/fr/account/export/download");
    expect(viaGet.status()).toBe(405);

    // Un autre compte n'y trouve pas ce projet.
    const context = await browser.newContext();
    const other = await context.newPage();
    const second = await signInOnboarded(other, "donnees-autre");
    const theirs = (await downloadData(other, second.password)).data;
    expect(theirs.research.projects).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain(token);
    await context.close();
  });

  test("l'export d'une modératrice ne contient pas les signalements d'autrui", async ({
    page,
    browser,
  }) => {
    // Un utilisateur signale une ressource publiée.
    const resourceId = randomUUID();
    const marker = `signalement${Date.now()}${Math.round(Math.random() * 1e6)}`;
    sql(`
      insert into public.resources
        (id, type_code, title, authors, language_code, program_code, source_kind, source_name,
         official_url, access_status, editorial_status, last_verified_at, published_at)
      values ('${resourceId}', 'article', 'Ressource signalée ${marker}', array['Auteur Test'], 'fr',
              'computer_science', 'connector', 'e2e-seed', 'https://exemple.invalid/${marker}',
              'open_access', 'published', now(), now())
    `);
    const reporterContext = await browser.newContext();
    const reporterPage = await reporterContext.newPage();
    const reporter = await signInOnboarded(reporterPage, "signaleur");
    await reporterPage.goto(`/fr/resources/${resourceId}`);
    await reporterPage.getByLabel("Motif").selectOption({ label: "Lien cassé" });
    await reporterPage.getByLabel("Précisions").fill(`Détail privé ${marker}`);
    await reporterPage.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(reporterPage).toHaveURL(/notice=reported/);

    // Le signaleur retrouve son signalement dans sa copie.
    const mine = (await downloadData(reporterPage, reporter.password)).data;
    expect(JSON.stringify(mine.catalogue.reports)).toContain(marker);
    await reporterContext.close();

    // La modératrice le lit en modération, mais sa copie ne le contient pas.
    const email = uniqueEmail("export-moderation");
    const password = strongPassword();
    const id = await createConfirmedUser(email, password);
    completeProfileDirectly(id);
    makeModerator(id);
    await signInThroughForm(page, email, password);
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, new Set()));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/fr\/account/);
    await page.goto("/fr/moderation");
    await expect(page.getByRole("main")).toContainText(`Détail privé ${marker}`);

    // La liste des signalements se parcourt par pages, et dit combien il y en a.
    // Vingt et un signalements datés dans l'avenir : ils se rangent en fin de
    // liste et ne déplacent ceux d'aucun autre test.
    const batch = `lot${Date.now()}${Math.round(Math.random() * 1e6)}`;
    sql(`
      with seeded as (
        insert into public.resources
          (type_code, title, authors, language_code, program_code, source_kind, source_name,
           official_url, access_status, editorial_status, last_verified_at, published_at)
        select 'article', 'Ressource ${batch} ' || g, array['Auteur Test'], 'fr', 'computer_science',
               'connector', 'e2e-seed', 'https://exemple.invalid/${batch}/' || g, 'open_access',
               'published', now(), now()
        from generate_series(1, 21) g
        returning id
      )
      insert into public.resource_reports (resource_id, reporter_id, reason, details, created_at)
      select id, '${reporter.id}', 'broken_link', 'Signalement ${batch}', now() + interval '10 years' from seeded
    `);
    try {
      await page.goto("/fr/moderation");
      const pages = page.getByTestId("reports-page");
      await expect(pages).toContainText("Page 1 sur");
      const total = Number((await page.getByRole("heading", { name: /Signalements ouverts/ }).innerText()).match(/\((\d+)\)/)?.[1]);
      expect(total).toBeGreaterThanOrEqual(22);
      const last = Math.ceil(total / 20);
      await page.goto(`/fr/moderation?rpage=${last}`);
      await expect(pages).toContainText(`Page ${last} sur`);
      // L'autre navigateur de la suite range aussi un lot en fin de liste : le
      // nôtre est sur l'une des dernières pages.
      let found = false;
      for (let target = last; target >= 2 && !found; target -= 1) {
        await page.goto(`/fr/moderation?rpage=${target}`);
        await expect(pages).toContainText("Page ");
        found = (await page.getByRole("main").innerText()).includes(`Signalement ${batch}`);
      }
      expect(found).toBe(true);
      // La page trouvée n'est pas la première : un lien ramène vers les précédentes.
      await expect(
        page.getByRole("navigation", { name: "Pages des signalements" }).getByRole("link", { name: "Page précédente" }),
      ).toBeVisible();
      // Une page au-delà de la dernière ramène à la première.
      await page.goto("/fr/moderation?rpage=499");
      await expect(pages).toContainText("Page 1 sur");
    } finally {
      sql(`delete from public.resource_reports where details = 'Signalement ${batch}'`);
      sql(`delete from public.resources where title like 'Ressource ${batch} %'`);
    }

    const { data } = await downloadData(page, password);
    expect(data.platform_roles).toEqual([expect.objectContaining({ role: "moderator" })]);
    expect(data.catalogue.reports).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(marker);
  });
});
