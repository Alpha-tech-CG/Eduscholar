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

async function signInOnboarded(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return id;
}

/** Un projet et ses sources, créés directement en base pour le compte donné. */
function seedProject(ownerId: string) {
  const projectId = randomUUID();
  const token = `bib${Date.now()}${Math.round(Math.random() * 1e6)}`;
  sql(`
    insert into public.research_projects (id, owner_id, title) values ('${projectId}', '${ownerId}', 'Mémoire ${token}');
    insert into public.project_sources
      (project_id, source_type, title, authors, publication_year, container_title, publisher, volume, issue, pages, doi)
    values
      ('${projectId}', 'article', 'Zones de confiance ${token}', array['Mensah, Kofi', 'Diop, Awa'], 2021,
       'Revue de test', null, '12', '3', '45-67', '10.5555/${token}'),
      ('${projectId}', 'book', 'Algorithmes ${token}', array['Diop, Awa'], 2019, null, 'Presses de test', null, null, null, null),
      ('${projectId}', 'book', 'algorithmes  ${token}.', array['Awa Diop'], 2019, null, null, null, null, null, null),
      ('${projectId}', 'report', '<img src=x onerror=alert(1)> ${token}', '{}', null, null, 'Organisme', null, null, null, null)
  `);
  return { projectId, token };
}

test.describe("bibliographie d'un projet", () => {
  test.setTimeout(90_000);

  test("références APA, signalements, langue et cloisonnement", async ({ page, browser }) => {
    const ownerId = await signInOnboarded(page, "bibliographie");
    const { projectId, token } = seedProject(ownerId);

    await page.goto(`/fr/projects/${projectId}`);
    await page.getByRole("main").getByRole("link", { name: "Bibliographie" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/bibliography`));

    await expect(page.getByTestId("bibliography-summary")).toHaveText("4 références, dont 3 à vérifier.");
    await expect(page.getByRole("heading", { name: "Références" })).toBeVisible();

    // Classement : sans auteur au titre (« < »), puis Awa Diop, Diop, Mensah.
    const references = page.getByTestId("reference");
    await expect(references).toHaveText([
      `<img src=x onerror=alert(1)> ${token}. (s. d.). Organisme.`,
      `Awa Diop. (2019). algorithmes  ${token}.`,
      `Diop, A. (2019). Algorithmes ${token}. Presses de test.`,
      `Mensah, K. et Diop, A. (2021). Zones de confiance ${token}. Revue de test, 12(3), 45-67. https://doi.org/10.5555/${token}`,
    ]);
    // Le balisage saisi dans un titre reste du texte.
    await expect(page.getByRole("main").locator("img")).toHaveCount(0);

    // Italique : la revue et le volume de l'article, le titre du livre.
    await expect(references.nth(3).locator("em")).toHaveText(["Revue de test", "12"]);
    await expect(references.nth(2).locator("em")).toHaveText([`Algorithmes ${token}`]);

    // Signalements : la référence complète n'en a pas.
    const items = page.getByRole("main").getByRole("listitem").filter({ has: page.getByTestId("reference") });
    await expect(items.nth(3).getByTestId("reference-issues")).toHaveCount(0);
    await expect(items.nth(0).getByTestId("reference-issues")).toContainText("Auteur manquant");
    await expect(items.nth(0).getByTestId("reference-issues")).toContainText("Année manquante");
    await expect(items.nth(1).getByTestId("reference-issues")).toContainText("Éditeur ou établissement manquant");
    await expect(items.nth(1).getByTestId("reference-issues")).toContainText("repris tel quel");
    await expect(items.nth(1).getByTestId("reference-issues")).toContainText("Doublon possible");
    await expect(items.nth(2).getByTestId("reference-issues")).toContainText("Doublon possible");

    // Texte à copier : les mêmes références, en texte brut.
    const plain = await page.getByLabel(/Texte brut/).inputValue();
    expect(plain.split("\n\n")).toHaveLength(4);
    expect(plain).toContain(`Mensah, K. et Diop, A. (2021). Zones de confiance ${token}.`);

    // --- En anglais ----------------------------------------------------------
    await page.getByRole("link", { name: "Anglais" }).click();
    await expect(page).toHaveURL(/lang=en/);
    await expect(page.getByRole("heading", { name: "References" })).toBeVisible();
    await expect(references.nth(3)).toContainText("Mensah, K. & Diop, A. (2021).");
    await expect(references.nth(0)).toContainText("(n.d.).");
    // Une langue inconnue dans l'adresse est ignorée.
    await page.goto(`/fr/projects/${projectId}/bibliography?lang=<script>`);
    await expect(page.getByRole("heading", { name: "Références" })).toBeVisible();

    // --- Corriger une source met la bibliographie à jour ---------------------
    await items.nth(0).getByRole("link", { name: "Corriger cette source" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/sources/[0-9a-f-]{36}`));
    await page.getByLabel("Titre de la source").fill(`Rapport annuel ${token}`);
    await page.getByLabel("Auteurs de la source").fill("Organisme de test");
    await page.getByLabel("Année").fill("2024");
    await page.getByRole("button", { name: "Enregistrer la référence" }).click();
    await expect(page).toHaveURL(/notice=saved/);
    await page.goto(`/fr/projects/${projectId}/bibliography`);
    await expect(page.getByTestId("reference").filter({ hasText: "Rapport annuel" })).toHaveText(
      `Organisme de test. (2024). Rapport annuel ${token}. Organisme.`,
    );

    // --- Cloisonnement -------------------------------------------------------
    const context = await browser.newContext();
    const other = await context.newPage();
    await signInOnboarded(other, "bibliographie-autre");
    expect((await other.goto(`/fr/projects/${projectId}/bibliography`))?.status()).toBe(404);
    await context.close();
  });

  test("un projet sans source a une bibliographie vide ; la page exige une session", async ({
    page,
    browser,
  }) => {
    const ownerId = await signInOnboarded(page, "bibliographie-vide");
    const projectId = randomUUID();
    sql(`insert into public.research_projects (id, owner_id, title) values ('${projectId}', '${ownerId}', 'Projet vide')`);
    await page.goto(`/fr/projects/${projectId}/bibliography`);
    await expect(page.getByRole("main")).toContainText("la bibliographie se construit à partir d'elles");
    await expect(page.getByTestId("reference")).toHaveCount(0);

    const context = await browser.newContext();
    const anonymous = await context.newPage();
    await anonymous.goto(`/fr/projects/${projectId}/bibliography`);
    await expect(anonymous).toHaveURL(/\/fr\/sign-in/);
    await context.close();
  });
});
