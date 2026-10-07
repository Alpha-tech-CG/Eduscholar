import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  signInThroughForm,
  sql,
  sqlValue,
  strongPassword,
  uniqueEmail,
  waitForInvitation,
} from "./support/auth";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
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

/** Un projet avec une section rédigée et une fiche de lecture, pour le compte donné. */
function seedProject(ownerId: string) {
  const projectId = randomUUID();
  const sourceId = randomUUID();
  const token = `partage${Date.now()}${Math.round(Math.random() * 1e6)}`;
  sql(`
    insert into public.research_projects (id, owner_id, title, problem_statement)
      values ('${projectId}', '${ownerId}', 'Mémoire ${token}', 'Problématique ${token}');
    insert into public.project_sources (id, project_id, source_type, title, authors, publication_year)
      values ('${sourceId}', '${projectId}', 'article', 'Source ${token}', array['Diop, Awa'], 2021);
    insert into public.literature_notes (source_id, problem) values ('${sourceId}', 'Fiche privée ${token}');
    insert into public.thesis_sections (project_id, position, level, title, body)
      values ('${projectId}', 1, 1, 'Introduction', 'Texte du mémoire ${token}.')
  `);
  return { projectId, token };
}

test.describe("partage d'un projet avec un encadreur", () => {
  test.setTimeout(180_000);

  test("invitation, acceptation, lecture seule, retrait", async ({ page, browser }) => {
    const owner = await createMember("partage-etudiante");
    const supervisor = await createMember("partage-encadreur");
    const stranger = await createMember("partage-tiers");
    const { projectId, token } = seedProject(owner.id);

    await signInThroughForm(page, owner.email, owner.password);
    await expect(page).toHaveURL(/\/fr\/account/);

    // --- Le projet est privé tant que personne n'est invité -------------------
    await page.goto(`/fr/projects/${projectId}`);
    await page.getByRole("link", { name: "Gérer le partage" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/sharing`));
    await expect(page.getByRole("main")).toContainText("Votre projet est privé");

    // --- Inviter ---------------------------------------------------------------
    await page.getByLabel("Adresse électronique de la personne").fill("pas-une-adresse");
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");

    await page.getByLabel("Adresse électronique de la personne").fill(owner.email);
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(alert(page)).toContainText("propre compte");

    await page.getByLabel("Adresse électronique de la personne").fill(supervisor.email.toUpperCase());
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(page).toHaveURL(/notice=invited$/);
    await expect(status(page)).toHaveText("L'invitation est envoyée.");
    await expect(page.getByTestId("invitation")).toContainText(supervisor.email);
    // Le jeton n'apparaît ni dans la page, ni dans son adresse.
    const invitation = await waitForInvitation(supervisor.email);
    const secret = invitation.path.split("/").pop() ?? "";
    expect(page.url()).not.toContain(secret);
    expect(await page.content()).not.toContain(secret);
    // Le courriel nomme la personne qui invite, pas le projet ; un seul lien, répété dans chaque langue.
    expect(invitation.html).toContain(owner.email);
    expect(invitation.html).not.toContain(token);
    expect(invitation.html.match(/href="/g)).toHaveLength(2);
    // La base ne garde que l'empreinte du jeton.
    expect(sqlValue(`select count(*) from public.project_invitations where token_hash = '${secret}'`)).toBe("0");

    // --- Le lien seul ne donne rien ---------------------------------------------
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto(invitation.path);
    await expect(visitor).toHaveURL(/\/fr\/sign-in/);
    await anonymous.close();

    const third = await openSession(browser, stranger);
    await third.page.goto(invitation.path);
    await expect(alert(third.page)).toContainText("n'est pas valable pour le compte");
    await expect(third.page.getByRole("button", { name: "Accepter l'invitation" })).toHaveCount(0);
    expect((await third.page.goto(`/fr/shared/${projectId}`))?.status()).toBe(404);
    await third.close();

    // --- La personne invitée accepte ---------------------------------------------
    const invited = await openSession(browser, supervisor);
    await invited.page.goto("/fr/shared");
    await expect(invited.page.getByRole("main")).toContainText("Aucun projet n'est partagé avec vous.");
    await invited.page.goto(invitation.path);
    await expect(invited.page.getByTestId("invitation-preview")).toContainText(owner.email);
    await expect(invited.page.getByTestId("invitation-preview")).toContainText(`Mémoire ${token}`);
    await invited.page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(invited.page).toHaveURL(new RegExp(`/fr/shared/${projectId}\\?notice=joined`));
    await expect(status(invited.page)).toHaveText("Vous suivez maintenant ce projet.");

    // --- Lecture seule : le texte, pas les fiches de lecture ----------------------
    await expect(invited.page.getByTestId("shared-role")).toContainText("lecture seule");
    await expect(invited.page.getByRole("main")).toContainText(`Problématique ${token}`);
    await expect(invited.page.getByTestId("document")).toContainText(`Texte du mémoire ${token}.`);
    await expect(invited.page.getByRole("main")).not.toContainText(`Fiche privée ${token}`);
    // Les pages de travail du propriétaire lui restent introuvables.
    for (const path of ["", "/edit", "/outline", "/sources", "/sharing", "/document"]) {
      expect((await invited.page.goto(`/fr/projects/${projectId}${path}`))?.status(), path).toBe(404);
    }
    await invited.page.goto("/fr/shared");
    await expect(invited.page.getByTestId("shared-project")).toContainText(`Mémoire ${token}`);
    await expect(invited.page.getByTestId("shared-project")).toContainText(owner.email);

    // Le lien ne sert qu'une fois.
    await invited.page.goto(invitation.path);
    await expect(alert(invited.page)).toContainText("n'est pas valable pour le compte");

    // --- Le propriétaire voit sa nouvelle encadreure, puis la retire ---------------
    await page.goto(`/fr/projects/${projectId}/sharing`);
    await expect(page.getByTestId("invitation")).toHaveCount(0);
    await expect(page.getByTestId("member")).toContainText(supervisor.email);
    await expect(page.getByTestId("member")).toContainText("Encadrement");
    await page.getByRole("button", { name: "Retirer cette personne" }).click();
    await expect(page).toHaveURL(/notice=removed$/);
    await expect(page.getByRole("main")).toContainText("Votre projet est privé");

    // Effet immédiat pour la personne retirée.
    expect((await invited.page.goto(`/fr/shared/${projectId}`))?.status()).toBe(404);
    await invited.page.goto("/fr/shared");
    await expect(invited.page.getByTestId("shared-project")).toHaveCount(0);

    // --- Réinvitée en lecture seule, puis l'invitation est annulée -----------------
    await page.getByLabel("Adresse électronique de la personne").fill(supervisor.email);
    await page.getByLabel("Ce qu'elle pourra faire").selectOption({ label: "Lire seulement" });
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(page).toHaveURL(/notice=invited$/);
    await expect(page.getByTestId("invitation")).toContainText("Lecture seule");
    await page.getByRole("button", { name: "Annuler l'invitation" }).click();
    await expect(page).toHaveURL(/notice=revoked$/);
    await expect(page.getByTestId("invitation")).toHaveCount(0);
    expect(
      sqlValue(`select count(*) from public.project_invitations where project_id = '${projectId}' and status = 'pending'`),
    ).toBe("0");

    // --- Réinvitée et acceptée, elle quitte d'elle-même ------------------------------
    await page.getByLabel("Adresse électronique de la personne").fill(supervisor.email);
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(page).toHaveURL(/notice=invited$/);
    const pending = sqlValue(
      `select count(*) from public.project_invitations where project_id = '${projectId}' and status = 'pending'`,
    );
    expect(pending).toBe("1");
    // Seul le dernier lien reçu vaut : il diffère du premier, déjà consommé.
    // Troisième invitation reçue par cette adresse.
    const current = await waitForInvitation(supervisor.email, 2);
    expect(current.path).not.toBe(invitation.path);
    await invited.page.goto(current.path);
    await invited.page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(invited.page).toHaveURL(new RegExp(`/fr/shared/${projectId}\\?notice=joined`));

    // Quitter demande une confirmation.
    await invited.page.getByRole("button", { name: "Quitter ce projet" }).click();
    await expect(alert(invited.page)).toHaveText("Certains champs sont à corriger.");
    await invited.page.getByLabel("Je ne veux plus suivre ce projet.").check();
    await invited.page.getByRole("button", { name: "Quitter ce projet" }).click();
    await expect(invited.page).toHaveURL(/\/fr\/shared\?notice=left/);
    await expect(status(invited.page)).toHaveText("Vous ne suivez plus ce projet.");
    expect((await invited.page.goto(`/fr/shared/${projectId}`))?.status()).toBe(404);
    await page.goto(`/fr/projects/${projectId}/sharing`);
    await expect(page.getByRole("main")).toContainText("Votre projet est privé");

    await invited.close();
  });

  test("les pages de partage exigent une session", async ({ page }) => {
    for (const path of ["/fr/shared", `/fr/shared/${randomUUID()}`, `/fr/projects/${randomUUID()}/sharing`]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/fr\/sign-in/);
    }
  });
});
