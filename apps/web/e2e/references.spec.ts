import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  makeAdmin,
  signInThroughForm,
  sql,
  sqlValue,
  strongPassword,
  TEST_FACTOR_SECRET,
  uniqueEmail,
} from "./support/auth";
import { freshTotp } from "./support/totp";

// Administration des référentiels : créer, activer, modifier, désactiver une
// ligne, et ce qu'en voit le formulaire de profil d'un utilisateur.

// Une adresse de client propre à ce fichier : ses connexions ne pèsent pas sur
// la limite par adresse que se partagent les autres parcours.
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.24" } });

const status = (page: Page) => page.getByRole("main").getByRole("status");

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

const rowOf = (page: Page, code: string) => page.locator(`[data-testid="reference-item"][data-code="${code}"]`);

/** Le volet repliable d'une ligne, ouvert. */
async function openPanel(row: Locator, summary: string): Promise<Locator> {
  const panel = row.locator("details").filter({ has: row.page().locator("summary", { hasText: summary }) });
  await panel.locator("summary").click();
  return panel;
}

test.describe("administration des référentiels", () => {
  test.setTimeout(240_000);

  test("une matière : créée inactive, activée, renommée, désactivée", async ({ browser }) => {
    const admin = await createMember("ref-admin");
    makeAdmin(admin.id, "platform_admin");
    // Son profil, complété hors application, est en filière « computer_science ».
    const student = await createMember("ref-etudiante");
    const tag = randomUUID().slice(0, 8);
    const code = `e2e_${tag}`;
    const label = `Matière fictive ${tag}`;
    const renamed = `Matière renommée ${tag}`;
    const stored = () =>
      sqlValue(
        `select is_active::text || '|' || (labels ->> 'fr') from public.subjects where program_code = 'computer_science' and code = '${code}'`,
      );

    const session = await openSessionWithCode(browser, admin);
    const { page } = session;
    const reader = await openSession(browser, student);
    const subjects = reader.page.getByRole("group", { name: /Matières suivies/ });
    try {
      // --- L'écran, son sélecteur ---------------------------------------------------
      await page.getByRole("link", { name: "Administration" }).click();
      await page.getByRole("link", { name: "Administrer les référentiels" }).click();
      await expect(page).toHaveURL(/\/fr\/admin\/references$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Référentiels");
      await expect(page.getByTestId("reference-kind")).toHaveText("Pays");
      // Les pays ne se créent pas ; la liste est paginée.
      await expect(page.getByTestId("no-creation")).toBeVisible();
      await expect(page.getByRole("button", { name: "Créer la ligne" })).toHaveCount(0);
      await expect(page.getByTestId("references-page")).toContainText("Page 1 sur");
      await expect(page.getByTestId("reference-item")).toHaveCount(25);
      // Une valeur hors de la liste fermée : le premier référentiel.
      await page.goto("/fr/admin/references?kind=auth.users");
      await expect(page.getByTestId("reference-kind")).toHaveText("Pays");

      // Le filtre porte sur le code et les libellés, sans égard aux accents.
      await page.getByLabel("Filtrer par code ou libellé").fill("senegal");
      await page.getByRole("button", { name: "Filtrer", exact: true }).click();
      await expect(page).toHaveURL(/q=senegal/);
      await expect(page.getByTestId("reference-total")).toHaveText("1 ligne correspond au filtre");
      await expect(rowOf(page, "SN")).toContainText("Sénégal");

      await page.getByRole("link", { name: "Matières", exact: true }).click();
      await expect(page).toHaveURL(/kind=subjects$/);
      await expect(page.getByTestId("reference-kind")).toHaveText("Matières");
      await expect(page.getByTestId("create-inactive")).toContainText("Une ligne créée est inactive");

      // --- Créer : la ligne naît inactive ---------------------------------------------
      const create = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: /Ajouter une ligne/ }) })
        .last();
      await create.getByLabel("Filière").selectOption("computer_science");
      await create.getByLabel("Code", { exact: true }).fill("Pas Valide");
      await create.getByLabel("Libellé français").fill(label);
      await create.getByLabel("Libellé anglais").fill(`Fictitious subject ${tag}`);
      await create.getByRole("button", { name: "Créer la ligne" }).click();
      await expect(create.getByRole("alert")).toHaveText("Certains champs sont à corriger.");
      await expect(create.getByLabel("Code", { exact: true })).toHaveAttribute("aria-invalid", "true");

      await create.getByLabel("Code", { exact: true }).fill(code);
      await create.getByRole("button", { name: "Créer la ligne" }).click();
      await expect(page).toHaveURL(/notice=created$/);
      await expect(status(page)).toHaveText("La ligne est créée, inactive. Activez-la pour qu'elle soit proposée.");
      expect(stored()).toBe(`false|${label}`);

      // Le formulaire de création ne réécrit pas une ligne existante.
      await create.getByLabel("Filière").selectOption("computer_science");
      await create.getByLabel("Code", { exact: true }).fill(code);
      await create.getByLabel("Libellé français").fill("Écrasement");
      await create.getByLabel("Libellé anglais").fill("Overwrite");
      await create.getByRole("button", { name: "Créer la ligne" }).click();
      await expect(create.getByRole("alert")).toContainText("Une ligne porte déjà ce code");
      expect(stored()).toBe(`false|${label}`);

      await page.getByLabel("Filtrer par code ou libellé").fill(code);
      await page.getByRole("button", { name: "Filtrer", exact: true }).click();
      await expect(page.getByTestId("reference-total")).toHaveText("1 ligne correspond au filtre");
      const row = rowOf(page, code);
      await expect(row).toContainText(label);
      await expect(row).toContainText("Informatique (computer_science)");
      await expect(row.getByTestId("reference-state")).toHaveText("Inactive");
      await expect(row.getByTestId("reference-usage")).toHaveText("aucun usage");

      // Inactive : le profil ne la propose pas.
      await reader.page.goto("/fr/account/profile");
      await expect(subjects).toBeVisible();
      await expect(subjects.getByLabel(label)).toHaveCount(0);

      // --- Activer : elle est proposée -------------------------------------------------
      await row.getByRole("button", { name: "Activer", exact: true }).click();
      await expect(page).toHaveURL(/notice=activated$/);
      // Le filtre est gardé d'une action à l'autre.
      expect(page.url()).toContain(`q=${code}`);
      await expect(row.getByTestId("reference-state")).toHaveText("Active");

      await reader.page.reload();
      await subjects.getByLabel(label).check();
      await reader.page.getByRole("button", { name: "Enregistrer mon profil" }).click();
      await expect(reader.page).toHaveURL(/\/fr\/account\?notice=profile-saved/);

      // --- Modifier le libellé ------------------------------------------------------------
      await page.reload();
      await expect(row.getByTestId("reference-usage")).toHaveText("1 usage");
      let panel = await openPanel(row, "Modifier");
      await panel.getByLabel("Libellé français").fill("<b>balise</b>");
      await panel.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(panel.getByRole("alert")).toHaveText("Certains champs sont à corriger.");
      await panel.getByLabel("Libellé français").fill(renamed);
      await panel.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(page).toHaveURL(/notice=updated$/);
      await expect(status(page)).toHaveText("La ligne est enregistrée.");
      await expect(row.getByRole("heading")).toHaveText(renamed);
      expect(stored()).toBe(`true|${renamed}`);

      await reader.page.goto("/fr/account/profile");
      await expect(subjects.getByLabel(renamed)).toBeChecked();
      await expect(subjects.getByLabel(label)).toHaveCount(0);

      // --- Désactiver : dit ce que cela fait, puis n'est plus proposée ---------------------
      panel = await openPanel(row, "Désactiver");
      await expect(panel.getByTestId("deactivate-help")).toContainText("ne sera plus proposée");
      await expect(panel.getByTestId("deactivate-help")).toContainText("(1 usage)");
      await panel.getByRole("button", { name: "Désactiver cette ligne" }).click();
      await expect(page).toHaveURL(/notice=deactivated$/);
      await expect(row.getByTestId("reference-state")).toHaveText("Inactive");

      await reader.page.reload();
      await expect(subjects).toBeVisible();
      await expect(subjects.getByLabel(renamed)).toHaveCount(0);
      // Le profil qui la portait la garde.
      expect(sqlValue(`select '${code}' = any (subject_codes) from public.profiles where user_id = '${student.id}'`)).toBe(
        "t",
      );

      // --- Un code dont la plateforme a besoin ne se désactive pas --------------------------
      await page.goto("/fr/admin/references?kind=resource_types&q=thesis");
      const thesis = rowOf(page, "thesis");
      await expect(thesis.getByTestId("reference-state")).toHaveText("Active");
      panel = await openPanel(thesis, "Désactiver");
      await panel.getByRole("button", { name: "Désactiver cette ligne" }).click();
      await expect(panel.getByRole("alert")).toContainText("nécessaire au fonctionnement de la plateforme");
      expect(sqlValue(`select is_active from public.resource_types where code = 'thesis'`)).toBe("t");

      // --- Les licences : lecture seule, aucun formulaire -------------------------------------
      await page.getByRole("link", { name: "Licences", exact: true }).click();
      await expect(page.getByTestId("reference-kind")).toHaveText("Licences");
      await expect(page.getByTestId("read-only-reference")).toContainText("Les licences se consultent seulement");
      await expect(page.getByRole("table")).toBeVisible();
      for (const column of ["Hébergement", "Redistribution", "Usage commercial", "Attribution exigée"]) {
        await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
      }
      await expect(page.getByTestId("reference-item").first()).toBeVisible();
      // Le seul formulaire est celui du filtre.
      await expect(page.getByRole("main").locator("form")).toHaveCount(1);
      await expect(page.getByRole("main").locator("summary")).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("button")).toHaveText(["Filtrer"]);

      // --- Journal d'audit : les opérations, jamais un libellé ---------------------------------
      const trail = sqlValue(
        `select string_agg(action || ' ' || metadata::text, ',') from public.audit_logs where actor_id = '${admin.id}' and action like 'reference.%'`,
      );
      for (const action of ["reference.created", "reference.updated", "reference.activated", "reference.deactivated"]) {
        expect(trail, action).toContain(action);
      }
      expect(trail).not.toContain(tag);
    } finally {
      // Ni la matière fictive ni le rôle ne restent dans la base locale.
      sql(`delete from public.subjects where program_code = 'computer_science' and code = '${code}'`);
      sql(`delete from public.platform_roles where user_id = '${admin.id}'`);
      await reader.close();
      await session.close();
    }
  });

  test("l'administration des référentiels est introuvable sans rôle", async ({ page }) => {
    // Visiteur : renvoyé à la connexion.
    await page.goto("/fr/admin/references");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Fadmin%2Freferences/);

    // Utilisateur sans rôle : introuvable, quel que soit le référentiel demandé.
    const member = await createMember("ref-sans-role");
    await signInThroughForm(page, member.email, member.password);
    await expect(page).toHaveURL(/\/fr\/admin\/references|\/fr\/account/);
    expect((await page.goto("/fr/admin/references"))?.status()).toBe(404);
    expect((await page.goto("/fr/admin/references?kind=licenses"))?.status()).toBe(404);
  });
});
