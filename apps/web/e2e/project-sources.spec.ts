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

async function signInOnboarded(page: Page, label: string) {
  const email = uniqueEmail(label);
  const password = strongPassword();
  completeProfileDirectly(await createConfirmedUser(email, password));
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
}

/** Une fiche publiée du catalogue, créée directement en base. */
function seedResource() {
  const id = randomUUID();
  const token = `src${Date.now()}${Math.round(Math.random() * 1e6)}`;
  sql(`
    insert into public.resources
      (id, type_code, title, authors, publication_year, institution_name, language_code, program_code,
       source_kind, source_name, official_url, access_status, license_code, editorial_status,
       last_verified_at, published_at)
    values
      ('${id}', 'article', 'Réseaux de neurones ${token}', array['Awa Diop', 'Kofi Mensah'], 2021,
       'Université de test', 'fr', 'computer_science', 'connector', 'e2e-seed',
       'https://exemple.invalid/${token}', 'open_access', 'cc-by-4.0', 'published', now(), now())
  `);
  return { id, title: `Réseaux de neurones ${token}` };
}

test.describe("sources d'un projet et fiches de lecture", () => {
  test.setTimeout(150_000);

  test("sources saisies et reprises, fiche de lecture, matrice, cloisonnement", async ({
    page,
    browser,
  }) => {
    const resource = seedResource();
    const projectTitle = `Mémoire ${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    await signInOnboarded(page, "sources");

    await page.goto("/fr/projects");
    await page.getByLabel("Titre provisoire").fill(projectTitle);
    await page.getByRole("button", { name: "Créer le projet" }).click();
    await expect(page).toHaveURL(/\/fr\/projects\/[0-9a-f-]{36}\/edit/);
    const projectUrl = page.url().replace(/\/edit.*$/, "");

    await page.goto(projectUrl);
    await expect(page.getByTestId("source-count")).toHaveText("Aucune source pour l'instant.");
    await page.getByRole("link", { name: "Gérer les sources" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectUrl}/sources`));
    await expect(page.getByRole("heading", { name: "Aucune source" })).toBeVisible();

    // --- Saisie d'une source : refus, puis succès ----------------------------
    await page.getByLabel("Type de source").selectOption({ label: "Article de revue" });
    await page.getByLabel("Titre de la source").fill("Apprentissage profond pour la détection");
    await page.getByLabel("Auteurs de la source").fill("Yann Martin\nAwa Diop");
    await page.getByLabel("Année").fill("20");
    await page.getByLabel("Adresse web").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Ajouter la source" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await expect(page.getByLabel("Titre de la source")).toHaveValue(
      "Apprentissage profond pour la détection",
    );

    await page.getByLabel("Année").fill("2020");
    await page.getByLabel("Adresse web").fill("https://exemple.invalid/article");
    await page.getByLabel("Revue, ouvrage ou site").fill("Revue de test");
    await page.getByLabel("Pages", { exact: true }).fill("45-67");
    await page.getByRole("button", { name: "Ajouter la source" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectUrl}/sources/[0-9a-f-]{36}\\?notice=added`));
    await expect(status(page)).toContainText("La source est ajoutée");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Apprentissage profond pour la détection",
    );
    const sourceUrl = page.url().split("?")[0] ?? "";
    const link = page.getByRole("main").getByRole("link", { name: "https://exemple.invalid/article" });
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);

    // --- Fiche de lecture ----------------------------------------------------
    await page.getByLabel("Problème étudié").fill("Détection d'attaques inconnues");
    await page.getByLabel("Concepts et thème").fill("Apprentissage supervisé");
    await page.getByLabel("Méthode").fill("Réseau convolutif.\nValidation croisée.");
    await page.getByLabel("Résultats").fill("Précision de 97 % <b>annoncée</b>");
    await page.getByLabel("Limites").fill("Un seul jeu de données");
    await page.getByLabel("Citation utile").fill("Le modèle généralise mal.");
    await page.getByLabel("Pages ou sections de la citation").fill("p. 52");
    await page.getByLabel("Chapitre visé").fill("État de l'art");
    await page.getByRole("button", { name: "Enregistrer la fiche de lecture" }).click();
    await expect(page).toHaveURL(/notice=note-saved/);
    await expect(status(page)).toContainText("La fiche de lecture est enregistrée");
    await expect(page.getByLabel("Méthode")).toHaveValue("Réseau convolutif.\nValidation croisée.");
    await expect(page.getByLabel("Pages ou sections de la citation")).toHaveValue("p. 52");

    // --- Correction de la référence, sans toucher à la fiche ------------------
    await page.getByLabel("Pages", { exact: true }).fill("45-70");
    await page.getByRole("button", { name: "Enregistrer la référence" }).click();
    await expect(page).toHaveURL(/notice=saved/);
    await expect(page.getByLabel("Pages", { exact: true })).toHaveValue("45-70");
    await expect(page.getByLabel("Problème étudié")).toHaveValue("Détection d'attaques inconnues");

    // --- Reprise d'une fiche du catalogue ------------------------------------
    await page.goto(`/fr/resources/${resource.id}`);
    await expect(page.getByRole("heading", { name: "Utiliser comme source d'un projet" })).toBeVisible();
    await page.getByRole("button", { name: "Ajouter aux sources du projet" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectUrl}/sources/[0-9a-f-]{36}\\?notice=added`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(resource.title);
    await expect(page.getByRole("main")).toContainText("Reprise du catalogue");
    await expect(page.getByLabel("Auteurs de la source")).toHaveValue("Awa Diop\nKofi Mensah");
    await expect(page.getByLabel("Année")).toHaveValue("2021");
    // Rien n'est complété : la date de consultation reste à saisir, et
    // l'institution d'un article n'est pas prise pour son éditeur.
    await expect(page.getByLabel("Date de consultation")).toHaveValue("");
    await expect(page.getByLabel("Éditeur ou établissement")).toHaveValue("");
    const copiedUrl = page.url().split("?")[0] ?? "";

    // Reprise une seconde fois : la même source, pas un doublon.
    await page.goto(`/fr/resources/${resource.id}`);
    await page.getByRole("button", { name: "Ajouter aux sources du projet" }).click();
    await expect(page).toHaveURL(new RegExp(copiedUrl));

    // --- Liste et matrice ----------------------------------------------------
    await page.goto(`${projectUrl}/sources`);
    await expect(page.getByRole("heading", { name: "2 sources" })).toBeVisible();
    const items = page.getByRole("main").getByRole("listitem");
    await expect(
      items.filter({ hasText: "Apprentissage profond" }).getByTestId("note-state"),
    ).toHaveText("Fiche de lecture commencée");
    await expect(items.filter({ hasText: resource.title }).getByTestId("note-state")).toHaveText(
      "Pas encore de fiche de lecture",
    );

    await page.getByRole("link", { name: "Matrice de littérature" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectUrl}/matrix`));
    const row = page.getByRole("row").filter({ hasText: "Apprentissage profond" });
    await expect(row).toContainText("Apprentissage supervisé");
    await expect(row).toContainText("Réseau convolutif.");
    // Le balisage saisi reste du texte.
    await expect(row).toContainText("Précision de 97 % <b>annoncée</b>");
    await expect(row).toContainText("Un seul jeu de données");
    await expect(row).toContainText("État de l'art");
    await expect(page.getByRole("columnheader")).toHaveText([
      "Source", "Thème", "Méthode", "Résultat", "Limite", "Utilité",
    ]);

    // --- La fiche du catalogue est retirée : la source reste -----------------
    sql(`update public.resources set editorial_status = 'removed' where id = '${resource.id}'`);
    await page.goto(copiedUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(resource.title);
    // ... mais sans la caution du catalogue : ni mention, ni lien cliquable.
    await expect(page.getByTestId("withdrawn-notice")).toContainText("ne figure plus au catalogue");
    await expect(page.getByRole("main")).not.toContainText("Reprise du catalogue");
    await expect(page.getByRole("main").getByRole("link", { name: "voir la ressource" })).toHaveCount(0);
    await expect(page.getByTestId("source-url-text")).toBeVisible();
    await expect(page.getByRole("main").locator('a[target="_blank"]')).toHaveCount(0);

    // --- Cloisonnement -------------------------------------------------------
    const context = await browser.newContext();
    const other = await context.newPage();
    await signInOnboarded(other, "sources-autre");
    for (const path of [`${projectUrl}/sources`, sourceUrl, `${projectUrl}/matrix`]) {
      expect((await other.goto(path))?.status(), path).toBe(404);
    }
    // Une source servie sous un projet qui n'est pas le sien : introuvable.
    await other.goto("/fr/projects");
    await other.getByLabel("Titre provisoire").fill("Projet d'un autre");
    await other.getByRole("button", { name: "Créer le projet" }).click();
    await expect(other).toHaveURL(/\/fr\/projects\/[0-9a-f-]{36}\/edit/);
    const otherProject = other.url().replace(/\/edit.*$/, "");
    const sourceId = sourceUrl.split("/").pop();
    expect((await other.goto(`${otherProject}/sources/${sourceId}`))?.status()).toBe(404);
    await context.close();

    // --- Suppression d'une source --------------------------------------------
    await page.goto(sourceUrl);
    await page.getByRole("button", { name: "Supprimer cette source" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await page.getByLabel("Je veux supprimer cette source et sa fiche de lecture.").check();
    await page.getByRole("button", { name: "Supprimer cette source" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectUrl}/sources\\?notice=deleted`));
    await expect(page.getByRole("heading", { name: "1 source" })).toBeVisible();
    expect((await page.goto(sourceUrl))?.status()).toBe(404);
  });

  test("les sources exigent une session", async ({ page }) => {
    const id = randomUUID();
    await page.goto(`/fr/projects/${id}/sources`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
    await page.goto(`/fr/projects/${id}/matrix`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
  });
});
