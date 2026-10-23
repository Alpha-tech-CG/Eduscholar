import { randomUUID } from "node:crypto";
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

// Assistance documentaire (cahier §8) : des suggestions et des constats
// calculés, que l'écran montre avec ce qui les justifie et n'applique jamais.

// Une adresse de client propre à ce fichier : ses connexions ne pèsent pas sur
// la limite par adresse que se partagent les autres parcours.
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.25" } });

type Member = { id: string; email: string; password: string };

async function createMember(label: string): Promise<Member> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  return { id, email, password };
}

async function openSession(browser: Browser, member: Member) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughForm(page, member.email, member.password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return { page, close: () => context.close() };
}

/** Ouvre une session au second facteur présenté. */
async function openSessionWithCode(browser: Browser, member: Member) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughForm(page, member.email, member.password);
  await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
  await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, new Set()));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/fr\/account/);
  return { page, close: () => context.close() };
}

type Seed = {
  title: string;
  status: "pending" | "published";
  url: string;
  authors?: string;
  subjects?: string;
  tags?: string;
};

/** Une fiche du catalogue, en filière « computer_science », créée hors application. */
function seedResource({ title, status, url, authors = "Awa Diop", subjects = "", tags = "" }: Seed): string {
  const id = randomUUID();
  const list = (values: string) =>
    values === "" ? "array[]::text[]" : `array[${values.split(",").map((value) => `'${value}'`).join(", ")}]`;
  const published = status === "published";
  sql(`
    insert into public.resources
      (id, type_code, title, authors, publication_year, language_code, program_code, source_kind, source_name,
       level_codes, subject_codes, tags, official_url, access_status, license_code,
       editorial_status, last_verified_at, published_at)
    values
      ('${id}', 'article', '${title}', ${list(authors)}, 2022, 'fr', 'computer_science', 'connector', 'e2e-seed',
       array['bachelor_3'], ${list(subjects)}, ${list(tags)}, '${url}', 'open_access', 'cc-by-4.0',
       '${status}', ${published ? "now()" : "null"}, ${published ? "now()" : "null"})
  `);
  return id;
}

/** Retire des lignes de test de la base locale, sans faire échouer le test. */
function cleanUp(statement: string) {
  try {
    sql(statement);
  } catch {
    // Le ménage est un confort.
  }
}

const idList = (ids: string[]) => ids.map((id) => `'${id}'`).join(", ");

test.describe("assistance documentaire", () => {
  test.setTimeout(240_000);

  test("modération : fiches ressemblantes et matière suggérée, appliquée par la personne", async ({ browser }) => {
    const moderator = await createMember("aide-moderation");
    makeModerator(moderator.id);
    const tag = randomUUID().slice(0, 8);
    const author = `Zed Auteur${tag}`;
    const title = `Cryptographie appliquée aux réseaux ${tag}`;
    const pending = seedResource({
      title,
      status: "pending",
      url: `https://exemple.invalid/${tag}/document`,
      authors: author,
      tags: "cryptographie",
    });
    const sameLink = seedResource({
      title: `Rapport annuel sans rapport ${tag}`,
      status: "published",
      url: `https://www.exemple.invalid/${tag}/document/`,
    });
    const nearTitle = seedResource({
      title: `Cryptographie appliquee aux reseaux ${tag}`,
      status: "published",
      url: `https://exemple.invalid/${tag}/autre`,
      authors: author,
    });
    // Un titre que rien ne rapproche d'un autre, même d'une exécution voisine.
    const lonelyTitle = `${randomUUID()} ${randomUUID()}`;
    const unrelated = seedResource({
      title: lonelyTitle,
      status: "published",
      url: `https://exemple.invalid/${tag}/botanique`,
    });
    const subjects = () => sqlValue(`select array_to_string(subject_codes, ',') from public.resources where id = '${pending}'`);

    const session = await openSessionWithCode(browser, moderator);
    const { page } = session;
    try {
      await page.goto(`/fr/moderation/${pending}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      const aid = page.getByTestId("moderation-assistance");
      // L'écran dit ce que c'est : des suggestions calculées, à vérifier.
      await expect(aid).toContainText("Suggestions calculées automatiquement");
      await expect(aid).toContainText("rien n'est appliqué");

      // --- Fiches qui ressemblent à celle-ci -----------------------------------------
      const similar = page.getByTestId("similar-resource");
      const byLink = similar.filter({ hasText: `Rapport annuel sans rapport ${tag}` });
      await expect(byLink).toContainText("même lien officiel");
      await expect(byLink).toContainText("Publiée");
      await expect(byLink).toContainText("indice de confiance");
      const byTitle = similar.filter({ hasText: `Cryptographie appliquee aux reseaux ${tag}` });
      await expect(byTitle).toContainText("titre proche");
      await expect(byTitle).toContainText("Proximité des titres : 100 %.");
      await expect(page.getByTestId("similar-resources")).not.toContainText(lonelyTitle);
      // Le titre mène à la fiche correspondante, en modération.
      await expect(byTitle.getByRole("link")).toHaveAttribute("href", `/fr/moderation/${nearTitle}`);

      // --- Matière suggérée : avec les mots qui ont correspondu -------------------------
      const suggestion = page.getByTestId("suggested-subject").filter({ hasText: "Cryptographie" });
      await expect(suggestion).toContainText("cryptographie");
      await expect(suggestion).toContainText("indice de confiance : élevé");
      // Rien n'a été appliqué à l'ouverture de la page.
      expect(subjects()).toBe("");
      await expect(page.getByTestId("suggested-subjects").getByRole("button")).toHaveCount(0);

      // --- La personne décide : elle coche elle-même, dans le formulaire de correction ---
      await page.getByRole("link", { name: "Aller à la correction de la fiche" }).click();
      await expect(page).toHaveURL(/#correction$/);
      const group = page.getByRole("group", { name: "Matières" });
      await expect(group.getByLabel("Cryptographie", { exact: true })).not.toBeChecked();
      await group.getByLabel("Cryptographie", { exact: true }).check();
      await page.getByRole("button", { name: "Enregistrer la correction" }).click();
      await expect(page).toHaveURL(/notice=edited/);
      expect(subjects()).toBe("cryptography");
      expect(sqlValue(`select editorial_status from public.resources where id = '${pending}'`)).toBe("pending");
      // La matière portée n'est plus suggérée.
      await expect(page.getByTestId("suggested-subject").filter({ hasText: "Cryptographie" })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Matières" }).getByLabel("Cryptographie", { exact: true })).toBeChecked();

      // --- Une fiche sans rien de ressemblant le dit simplement ---------------------------
      await page.goto(`/fr/moderation/${unrelated}`);
      await expect(page.getByTestId("similar-resources")).toContainText("Aucune fiche ressemblante n'a été trouvée.");
    } finally {
      cleanUp(`delete from public.platform_roles where user_id = '${moderator.id}'`);
      cleanUp(`delete from public.resources where id in (${idList([pending, sameLink, nearTitle, unrelated])})`);
      await session.close();
    }
  });

  test("projet : rapport de cohérence du propriétaire et d'un membre, fermé aux autres", async ({ page, browser }) => {
    const owner = await createMember("aide-etudiante");
    const supervisor = await createMember("aide-encadreur");
    const limited = await createMember("aide-limite");
    const stranger = await createMember("aide-tiers");
    const tag = randomUUID().slice(0, 8);
    const projectId = randomUUID();
    const [intro, method, conclusion, cited, uncited] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const body = "Texte rédigé pour le contrôle. ".repeat(12);
    sql(`
      insert into public.research_projects (id, owner_id, title, problem_statement)
        values ('${projectId}', '${owner.id}', 'Mémoire ${tag}', 'Problématique ${tag}');
      insert into public.thesis_sections (id, project_id, position, level, title, body) values
        ('${intro}', '${projectId}', 1, 1, 'Introduction ${tag}', '${body}'),
        ('${method}', '${projectId}', 2, 1, 'Méthode ${tag}', '${body}'),
        ('${conclusion}', '${projectId}', 3, 1, 'Conclusion ${tag}', null);
      insert into public.project_sources (id, project_id, source_type, title, authors, publication_year) values
        ('${cited}', '${projectId}', 'article', 'Source citée ${tag}', array['Diop, Awa'], null),
        ('${uncited}', '${projectId}', 'article', 'Source oubliée ${tag}', array['Mensah, Kofi'], 2024);
      insert into public.section_citations (section_id, source_id) values ('${method}', '${cited}');
      insert into public.research_project_members (project_id, user_id, role, full_access) values
        ('${projectId}', '${supervisor.id}', 'supervisor', true),
        ('${projectId}', '${limited.id}', 'viewer', false)
    `);
    const finding = (target: Page, code: string) => target.locator(`[data-testid="finding"][data-code="${code}"]`);

    try {
      // --- Le propriétaire ouvre le rapport depuis son projet --------------------------
      await signInThroughForm(page, owner.email, owner.password);
      await expect(page).toHaveURL(/\/fr\/account/);
      await page.goto(`/fr/projects/${projectId}`);
      await page.getByRole("link", { name: "Contrôles de cohérence" }).click();
      await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/coherence$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contrôles de cohérence");
      // Des contrôles de forme, pas une évaluation.
      await expect(page.getByTestId("coherence-disclaimer")).toContainText("contrôles automatiques de forme");
      await expect(page.getByTestId("coherence-disclaimer")).toContainText("n'évaluent pas le fond du travail");
      await expect(page.getByTestId("coherence-totals")).toHaveText(
        "Examiné : 3 sections, 2 sources, 1 citation, aucune tâche.",
      );

      // Par familles.
      await expect(page.getByTestId("family-project")).toContainText("Fiche du projet et échéances");
      await expect(page.getByTestId("family-writing")).toContainText("Plan et rédaction");
      await expect(page.getByTestId("family-sources")).toContainText("Sources et citations");

      await expect(finding(page, "project_incomplete")).toContainText("3 rubriques de la fiche du projet sont vides.");
      await expect(finding(page, "project_incomplete")).toContainText(
        "Rubriques vides : Question principale, Objectif général, Méthodologie.",
      );
      await expect(finding(page, "section_without_citation")).toContainText("À vérifier");
      await expect(finding(page, "section_without_citation")).toContainText(`Introduction ${tag}`);
      await expect(finding(page, "section_without_citation")).not.toContainText(`Méthode ${tag}`);
      await expect(finding(page, "section_single_source")).toContainText(`Méthode ${tag}`);
      await expect(finding(page, "section_empty")).toContainText("Information");
      await expect(finding(page, "section_empty")).toContainText(`Conclusion ${tag}`);
      await expect(finding(page, "source_never_cited")).toContainText(`Source oubliée ${tag}`);
      await expect(finding(page, "source_incomplete")).toContainText(`Source citée ${tag}`);
      await expect(finding(page, "source_incomplete")).toContainText("manque : année");
      // Tiré de ses fiches de lecture : pour lui seul.
      await expect(finding(page, "cited_source_without_note")).toContainText(`Source citée ${tag}`);
      // Le rapport ne rend aucun texte du mémoire.
      await expect(page.getByTestId("coherence-report")).not.toContainText("Texte rédigé pour le contrôle");

      // Les liens mènent à ce que le constat désigne.
      await expect(finding(page, "source_never_cited").getByRole("link")).toHaveAttribute(
        "href",
        `/fr/projects/${projectId}/sources/${uncited}`,
      );
      await finding(page, "section_without_citation").getByRole("link", { name: `Introduction ${tag}` }).click();
      await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/outline/${intro}$`));
      // Rien n'a été modifié par la lecture du rapport.
      expect(sqlValue(`select count(*) from public.section_citations c join public.thesis_sections s on s.id = c.section_id where s.project_id = '${projectId}'`)).toBe("1");

      // Sa page n'est pas celle des membres.
      expect((await page.goto(`/fr/shared/${projectId}/coherence`))?.status()).toBe(404);

      // --- Un membre à accès complet : le rapport, sans le constat des fiches de lecture ---
      const guide = await openSession(browser, supervisor);
      await guide.page.goto(`/fr/shared/${projectId}`);
      await guide.page.getByRole("link", { name: "Contrôles de cohérence" }).click();
      await expect(guide.page).toHaveURL(new RegExp(`/fr/shared/${projectId}/coherence$`));
      await expect(guide.page.getByTestId("coherence-disclaimer")).toContainText("contrôles automatiques de forme");
      await expect(finding(guide.page, "section_without_citation")).toContainText(`Introduction ${tag}`);
      await expect(finding(guide.page, "source_never_cited")).toContainText("1 source n'est citée dans aucune section.");
      await expect(finding(guide.page, "cited_source_without_note")).toHaveCount(0);
      // Ni page de source ni fiche du projet ne lui sont ouvertes : pas de lien vers elles.
      await expect(finding(guide.page, "source_never_cited").getByRole("link")).toHaveCount(0);
      await expect(guide.page.getByRole("link", { name: "Compléter la fiche du projet" })).toHaveCount(0);
      await finding(guide.page, "section_without_citation").getByRole("link", { name: `Introduction ${tag}` }).click();
      await expect(guide.page).toHaveURL(new RegExp(`/fr/shared/${projectId}/sections/${intro}$`));
      expect((await guide.page.goto(`/fr/projects/${projectId}/coherence`))?.status()).toBe(404);

      // Même quand le rapport ne peut pas être lu (quota épuisé), la page du
      // propriétaire reste introuvable pour un membre : la propriété passe avant.
      sql(`
        insert into private.rate_limit_buckets (bucket_key, window_start, hits)
        values (
          'project-coherence:user:' || left(encode(sha256(convert_to('project-coherence:${supervisor.id}', 'UTF8')), 'hex'), 40),
          to_timestamp(floor(extract(epoch from clock_timestamp()) / 300) * 300),
          1000
        )
        on conflict (bucket_key, window_start) do update set hits = 1000
      `);
      expect((await guide.page.goto(`/fr/projects/${projectId}/coherence`))?.status()).toBe(404);
      // Sur sa propre page, le membre lit que le rapport est limité, sans rien d'autre.
      await guide.page.goto(`/fr/shared/${projectId}/coherence`);
      await expect(guide.page.getByRole("main").getByRole("alert")).toContainText("Trop de demandes");
      await expect(guide.page.getByTestId("coherence-report")).toHaveCount(0);
      await guide.close();

      // --- Un membre à accès limité : ni lien, ni page ----------------------------------------
      const partial = await openSession(browser, limited);
      await partial.page.goto(`/fr/shared/${projectId}`);
      await expect(partial.page.getByTestId("limited-access")).toBeVisible();
      await expect(partial.page.getByRole("link", { name: "Contrôles de cohérence" })).toHaveCount(0);
      expect((await partial.page.goto(`/fr/shared/${projectId}/coherence`))?.status()).toBe(404);
      await partial.close();

      // --- Un tiers : introuvable, comme un projet qui n'existe pas -----------------------------
      const other = await openSession(browser, stranger);
      for (const path of [
        `/fr/shared/${projectId}/coherence`,
        `/fr/projects/${projectId}/coherence`,
        `/fr/shared/${randomUUID()}/coherence`,
        `/fr/projects/${randomUUID()}/coherence`,
      ]) {
        expect((await other.page.goto(path))?.status(), path).toBe(404);
      }
      await other.close();

      // Visiteur : renvoyé à la connexion.
      const anonymous = await browser.newContext();
      const visitor = await anonymous.newPage();
      await visitor.goto(`/fr/projects/${projectId}/coherence`);
      await expect(visitor).toHaveURL(/\/fr\/sign-in/);
      await anonymous.close();
    } finally {
      cleanUp(`delete from public.research_projects where id = '${projectId}'`);
    }
  });

  test("recommandations : selon son profil et son projet, jamais une fiche en attente", async ({ page, browser }) => {
    const reader = await createMember("aide-lectrice");
    const neighbour = await createMember("aide-voisin");
    const tag = randomUUID().slice(0, 8);
    const author = `Zed Auteur${tag}`;
    sql(
      `update public.profiles set subject_codes = array['cryptography', 'databases', 'algorithms'] where user_id = '${reader.id}'`,
    );
    const published = seedResource({
      title: `Fiche recommandable ${tag}`,
      status: "published",
      url: `https://exemple.invalid/${tag}/publiee`,
      authors: author,
      subjects: "cryptography,databases,algorithms",
    });
    const waiting = seedResource({
      title: `Fiche en attente ${tag}`,
      status: "pending",
      url: `https://exemple.invalid/${tag}/attente`,
      authors: author,
      subjects: "cryptography,databases,algorithms",
    });
    const projectId = randomUUID();
    const foreignProject = randomUUID();
    sql(`
      insert into public.research_projects (id, owner_id, title) values
        ('${projectId}', '${reader.id}', 'Mémoire ${tag}'),
        ('${foreignProject}', '${neighbour.id}', 'Projet du voisin ${tag}');
      insert into public.project_sources (id, project_id, source_type, title, authors, publication_year) values
        ('${randomUUID()}', '${projectId}', 'article', 'Source ${tag}', array['${author}'], 2021)
    `);

    try {
      await signInThroughForm(page, reader.email, reader.password);
      await expect(page).toHaveURL(/\/fr\/account/);
      await page.getByRole("link", { name: "Recommandations pour moi" }).click();
      await expect(page).toHaveURL(/\/fr\/recommendations$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recommandations");
      // D'où elles viennent : de son seul profil, de son seul projet.
      await expect(page.getByTestId("recommendations-origin")).toContainText("votre seul profil");
      await expect(page.getByTestId("recommendations-origin")).toContainText(
        "Jamais à partir de l'activité des autres utilisateurs",
      );

      // --- D'après le profil : filière, matières, niveau ---------------------------------
      const card = page.getByTestId("resource-card").filter({ hasText: `Fiche recommandable ${tag}` });
      await expect(card).toBeVisible();
      const reasons = card.getByTestId("recommendation-reasons");
      await expect(reasons).toContainText("même filière que votre profil");
      await expect(reasons).toContainText("matière de votre profil");
      await expect(reasons).toContainText("même niveau que votre profil");
      await expect(reasons).not.toContainText("auteur déjà cité");
      await expect(card.getByRole("link")).toHaveAttribute("href", `/fr/resources/${published}`);
      // Jamais une fiche qui n'est pas publiée.
      await expect(page.getByRole("main")).not.toContainText(`Fiche en attente ${tag}`);
      expect(await page.content()).not.toContain(waiting);
      // Toutes les fiches montrées disent pourquoi.
      const cards = await page.getByTestId("resource-card").count();
      expect(cards).toBeGreaterThan(0);
      expect(cards).toBeLessThanOrEqual(20);
      await expect(page.getByTestId("recommendation-reasons")).toHaveCount(cards);

      // --- Affiné par son projet : un auteur déjà cité -------------------------------------
      // Le sélecteur ne propose que ses propres projets.
      const select = page.getByLabel("Affiner avec l'un de mes projets (facultatif)");
      await expect(select.locator("option")).toHaveText(["Aucun : mon profil seulement", `Mémoire ${tag}`]);
      await select.selectOption({ label: `Mémoire ${tag}` });
      await page.getByRole("button", { name: "Affiner" }).click();
      await expect(page).toHaveURL(new RegExp(`project=${projectId}`));
      await expect(card.getByTestId("recommendation-reasons")).toContainText("auteur déjà cité dans votre projet");
      await expect(page.getByRole("main")).not.toContainText(`Fiche en attente ${tag}`);

      // Le projet d'un autre, glissé dans l'adresse, est ignoré : son seul profil sert.
      await page.goto(`/fr/recommendations?project=${foreignProject}`);
      await expect(card.getByTestId("recommendation-reasons")).not.toContainText("auteur déjà cité");
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      await expect(select).toHaveValue("");

      // La recherche y mène aussi.
      await page.goto("/fr/search");
      await page.getByRole("link", { name: "Voir les recommandations" }).click();
      await expect(page).toHaveURL(/\/fr\/recommendations$/);

      // Visiteur : renvoyé à la connexion.
      const anonymous = await browser.newContext();
      const visitor = await anonymous.newPage();
      await visitor.goto("/fr/recommendations");
      await expect(visitor).toHaveURL(/\/fr\/sign-in\?next=%2Frecommendations/);
      await anonymous.close();
    } finally {
      cleanUp(`delete from public.research_projects where id in ('${projectId}', '${foreignProject}')`);
      cleanUp(`delete from public.resources where id in (${idList([published, waiting])})`);
    }
  });
});
