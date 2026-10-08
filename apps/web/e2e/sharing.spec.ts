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
  const sectionId = randomUUID();
  const token = `partage${Date.now()}${Math.round(Math.random() * 1e6)}`;
  sql(`
    insert into public.research_projects (id, owner_id, title, problem_statement)
      values ('${projectId}', '${ownerId}', 'Mémoire ${token}', 'Problématique ${token}');
    insert into public.project_sources (id, project_id, source_type, title, authors, publication_year)
      values ('${sourceId}', '${projectId}', 'article', 'Source ${token}', array['Diop, Awa'], 2021);
    insert into public.literature_notes (source_id, problem) values ('${sourceId}', 'Fiche privée ${token}');
    insert into public.thesis_sections (id, project_id, position, level, title, body)
      values ('${sectionId}', '${projectId}', 1, 1, 'Introduction', 'Texte du mémoire ${token}.')
  `);
  return { projectId, sectionId, token };
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

  test("commentaires : l'encadreur commente, l'étudiante répond et clôt, le lecteur lit", async ({
    page,
    browser,
  }) => {
    const owner = await createMember("commentaires-etudiante");
    const supervisor = await createMember("commentaires-encadreur");
    const viewer = await createMember("commentaires-lecteur");
    const { projectId, sectionId, token } = seedProject(owner.id);
    sql(`
      insert into public.research_project_members (project_id, user_id, role) values
        ('${projectId}', '${supervisor.id}', 'supervisor'),
        ('${projectId}', '${viewer.id}', 'viewer')
    `);
    const ownerSection = `/fr/projects/${projectId}/outline/${sectionId}`;
    const sharedSection = `/fr/shared/${projectId}/sections/${sectionId}`;

    // --- L'encadreur ouvre la section et commente un passage --------------------
    const guide = await openSession(browser, supervisor);
    await guide.page.goto(`/fr/shared/${projectId}`);
    await guide.page.getByTestId("shared-section").getByRole("link").click();
    await expect(guide.page).toHaveURL(new RegExp(`${sharedSection}$`));
    await expect(guide.page.getByTestId("section-text")).toContainText(`Texte du mémoire ${token}.`);
    await expect(guide.page.getByRole("main")).toContainText("Aucun commentaire sur cette section.");

    await guide.page.getByRole("button", { name: "Publier le commentaire" }).click();
    await expect(alert(guide.page)).toHaveText("Certains champs sont à corriger.");

    const remark = `Précisez <img src=x onerror="document.title='piege'"> la question ${token}.`;
    await guide.page.getByLabel("Passage visé (facultatif)").fill(`Texte du mémoire ${token}.`);
    await guide.page.getByLabel("Votre commentaire").fill(remark);
    await guide.page.getByRole("button", { name: "Publier le commentaire" }).click();
    await expect(guide.page).toHaveURL(/notice=commented/);
    const guideThread = guide.page.getByTestId("thread");
    await expect(guideThread).toContainText(remark);
    await expect(guideThread).toContainText("Vous");
    await expect(guideThread.locator("blockquote")).toContainText(`Texte du mémoire ${token}.`);
    // Le texte est affiché tel quel, jamais interprété.
    await expect(guide.page.locator("#comments img")).toHaveCount(0);
    expect(await guide.page.title()).not.toBe("piege");

    // --- L'étudiante en est avertie ; la notification la mène à la section ---------
    await signInThroughForm(page, owner.email, owner.password);
    await expect(page).toHaveURL(/\/fr\/account/);
    await expect(page.getByTestId("notifications-link")).toHaveText("Notifications (1 non lue)");
    await page.getByTestId("notifications-link").click();
    await expect(page.getByTestId("unread-count")).toHaveText("1 notification non lue.");
    const notification = page.getByTestId("notification");
    await expect(notification).toContainText(`Nouveau commentaire sur « Mémoire ${token} »`);
    // Une notification ne porte pas le texte du commentaire.
    await expect(notification).not.toContainText("Précisez");
    await page.getByRole("button", { name: "Tout marquer comme lu" }).click();
    await expect(page).toHaveURL(/notice=read$/);
    await expect(page.getByTestId("unread-count")).toHaveText("Tout est lu.");
    await page.getByTestId("notification").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`${ownerSection}$`));

    // --- Elle lit le commentaire sur sa page de rédaction, répond, puis clôt ------
    await page.goto(ownerSection);
    const thread = page.getByTestId("thread");
    await expect(thread).toContainText(remark);
    await expect(thread).toContainText(`Encadrement (${supervisor.email})`);
    await expect(page.getByTestId("open-threads")).toHaveText("1 fil ouvert.");
    // Elle ne supprime pas le commentaire de son encadreur.
    await expect(thread.getByRole("button", { name: "Supprimer mon commentaire" })).toHaveCount(0);

    await thread.getByLabel("Votre réponse").fill(`C'est précisé ${token}.`);
    await thread.getByRole("button", { name: "Répondre" }).click();
    await expect(page).toHaveURL(/notice=replied/);
    await expect(page.getByTestId("reply")).toContainText(`C'est précisé ${token}.`);

    await page.getByTestId("thread").getByRole("button", { name: "Clore ce fil" }).click();
    await expect(page).toHaveURL(/notice=resolved/);
    await expect(page.getByTestId("thread")).toHaveAttribute("data-resolved", "true");
    await expect(page.getByTestId("open-threads")).toHaveText("Tous les fils sont clos.");
    // Un fil clos ne reçoit plus de réponse tant qu'il n'est pas rouvert.
    await expect(page.getByTestId("thread").getByRole("button", { name: "Répondre" })).toHaveCount(0);

    // --- Le lecteur simple lit les commentaires, sans pouvoir en écrire -----------
    const reader = await openSession(browser, viewer);
    await reader.page.goto(sharedSection);
    await expect(reader.page.getByTestId("thread")).toContainText(remark);
    await expect(reader.page.getByTestId("reply")).toContainText(`Auteur du projet (${owner.email})`);
    for (const name of ["Publier le commentaire", "Répondre", "Clore ce fil", "Rouvrir ce fil"]) {
      await expect(reader.page.getByRole("button", { name })).toHaveCount(0);
    }
    await reader.close();

    // --- L'encadreur est averti de la réponse -----------------------------------------
    await guide.page.goto("/fr/notifications");
    await expect(guide.page.getByTestId("notification")).toContainText(
      `Réponse à un commentaire sur « Mémoire ${token} »`,
    );
    await guide.page.getByTestId("notification").getByRole("link").click();
    await expect(guide.page).toHaveURL(new RegExp(`${sharedSection}$`));

    // --- L'encadreur rouvre le fil, puis retire son commentaire --------------------
    await guide.page.goto(sharedSection);
    await expect(guide.page.getByTestId("thread")).toContainText("Fil clos");
    await guide.page.getByRole("button", { name: "Rouvrir ce fil" }).click();
    await expect(guide.page).toHaveURL(/notice=reopened/);
    await expect(guide.page.getByTestId("thread")).toHaveAttribute("data-resolved", "false");
    await guide.page.getByTestId("thread").getByRole("button", { name: "Supprimer mon commentaire" }).click();
    await expect(guide.page).toHaveURL(/notice=comment-deleted/);
    // On lui avait répondu : sa place reste dans le fil, sans son texte ni le passage cité.
    await expect(guide.page.getByTestId("thread")).toContainText("Commentaire retiré par son auteur.");
    await expect(guide.page.getByTestId("thread").locator("blockquote")).toHaveCount(0);
    await expect(guide.page.getByTestId("reply")).toContainText(`C'est précisé ${token}.`);
    expect(sqlValue(`select count(*) from public.project_comments where project_id = '${projectId}' and body like '%onerror%'`)).toBe("0");

    // --- Retiré du projet, l'encadreur ne voit plus rien --------------------------
    await page.goto(`/fr/projects/${projectId}/sharing`);
    await page
      .getByTestId("member")
      .filter({ hasText: supervisor.email })
      .getByRole("button", { name: "Retirer cette personne" })
      .click();
    await expect(page).toHaveURL(/notice=removed$/);
    expect((await guide.page.goto(sharedSection))?.status()).toBe(404);
    // Retiré, il ne voit plus les notifications de ce projet.
    await guide.page.goto("/fr/notifications");
    await expect(guide.page.getByRole("main")).toContainText("Aucune notification.");
    await guide.close();

    // Son ancien commentaire reste dans le fil de l'étudiante, sans adresse.
    await page.goto(ownerSection);
    await expect(page.getByTestId("thread")).toContainText("Ancien membre du projet");
    await expect(page.getByTestId("thread")).not.toContainText(supervisor.email);
  });

  test("versions : l'étudiante soumet, l'encadreur décide, l'historique reste", async ({
    page,
    browser,
  }) => {
    const owner = await createMember("versions-etudiante");
    const supervisor = await createMember("versions-encadreur");
    const viewer = await createMember("versions-lecteur");
    const { projectId, sectionId, token } = seedProject(owner.id);
    sql(`
      insert into public.research_project_members (project_id, user_id, role) values
        ('${projectId}', '${supervisor.id}', 'supervisor'),
        ('${projectId}', '${viewer.id}', 'viewer')
    `);

    // --- L'étudiante soumet une première version -------------------------------
    await signInThroughForm(page, owner.email, owner.password);
    await expect(page).toHaveURL(/\/fr\/account/);
    await page.goto(`/fr/projects/${projectId}`);
    await page.getByRole("link", { name: "Versions soumises à l'encadreur" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/versions$`));
    await expect(page.getByRole("main")).toContainText("Aucune version n'a encore été soumise.");

    await page.getByRole("button", { name: "Soumettre cette version" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await page.getByLabel("Intitulé (facultatif)").fill("Premier jet");
    await page.getByLabel(/Mot d.accompagnement/).fill(`Merci de relire ${token}.`);
    await page.getByLabel(/Je soumets mon document/).check();
    await page.getByRole("button", { name: "Soumettre cette version" }).click();
    await expect(page).toHaveURL(/notice=submitted$/);
    await expect(status(page)).toHaveText("La version est soumise.");
    const first = page.getByTestId("version");
    await expect(first).toContainText("Version 1 · Premier jet");
    await expect(first.getByTestId("version-status")).toHaveText("En attente de décision");

    // Elle continue d'écrire : la version soumise ne bouge pas.
    sql(`update public.thesis_sections set body = 'Texte repris ${token}.' where id = '${sectionId}'`);
    await first.getByRole("link").click();
    await expect(page.getByTestId("document")).toContainText(`Texte du mémoire ${token}.`);
    await expect(page.getByTestId("document")).not.toContainText("Texte repris");
    await expect(page.getByTestId("version-changes")).toContainText("C'est la première version soumise.");
    // Elle ne décide pas de sa propre version.
    await expect(page.getByRole("button", { name: "Enregistrer la décision" })).toHaveCount(0);

    // --- L'encadreur lit et demande des corrections ------------------------------
    const guide = await openSession(browser, supervisor);
    await guide.page.goto(`/fr/shared/${projectId}`);
    await guide.page.getByRole("link", { name: "Versions soumises et décisions" }).click();
    await expect(guide.page.getByTestId("version")).toContainText(`Merci de relire ${token}.`);
    await guide.page.getByTestId("version").getByRole("link").click();
    await expect(guide.page.getByTestId("document")).toContainText(`Texte du mémoire ${token}.`);

    await guide.page.getByLabel("Votre décision").selectOption({ label: "Corrections demandées" });
    await guide.page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(alert(guide.page)).toContainText("Un motif est nécessaire");
    await guide.page.getByLabel("Votre décision").selectOption({ label: "Corrections demandées" });
    await guide.page.getByLabel("Votre commentaire").fill(`Précisez la problématique ${token}.`);
    await guide.page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(guide.page).toHaveURL(/notice=decided$/);
    await expect(status(guide.page)).toHaveText("Votre décision est enregistrée.");

    // --- L'étudiante lit la décision, corrige, soumet à nouveau -------------------
    await page.goto(`/fr/projects/${projectId}/versions`);
    await expect(page.getByTestId("version-status")).toHaveText("Corrections demandées");
    await expect(page.getByTestId("decision")).toContainText(`Précisez la problématique ${token}.`);
    await expect(page.getByTestId("decision")).toContainText(supervisor.email);

    await page.getByLabel(/Je soumets mon document/).check();
    await page.getByRole("button", { name: "Soumettre cette version" }).click();
    await expect(page).toHaveURL(/notice=submitted$/);
    await expect(page.getByTestId("version")).toHaveCount(2);
    await page.getByTestId("version").first().getByRole("link").click();
    await expect(page.getByTestId("document")).toContainText(`Texte repris ${token}.`);
    await expect(page.getByTestId("version-changes")).toContainText("Sections modifiées : Introduction");

    // --- L'encadreur accepte la seconde ; l'historique de la première reste --------
    await guide.page.goto(`/fr/shared/${projectId}/versions`);
    await guide.page.getByTestId("version").first().getByRole("link").click();
    await guide.page.getByLabel("Votre décision").selectOption({ label: "Acceptée" });
    await guide.page.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(guide.page).toHaveURL(/notice=decided$/);
    await guide.page.goto(`/fr/shared/${projectId}/versions`);
    await expect(guide.page.getByTestId("version-status")).toHaveText(["Acceptée", "Corrections demandées"]);
    await expect(guide.page.getByTestId("decision").first()).toContainText("par vous");
    await guide.close();

    // --- Le lecteur simple lit versions et décisions, sans décider -----------------
    const reader = await openSession(browser, viewer);
    await reader.page.goto(`/fr/shared/${projectId}/versions`);
    await expect(reader.page.getByTestId("version")).toHaveCount(2);
    await expect(reader.page.getByTestId("decision").first()).toContainText("par l'encadreur");
    await expect(reader.page.getByRole("main")).not.toContainText(supervisor.email);
    await reader.page.getByTestId("version").first().getByRole("link").click();
    await expect(reader.page.getByTestId("document")).toContainText(`Texte repris ${token}.`);
    await expect(reader.page.getByRole("button", { name: "Enregistrer la décision" })).toHaveCount(0);
    // La page de version du propriétaire lui reste introuvable.
    const versionId = reader.page.url().split("/").pop() ?? "";
    expect((await reader.page.goto(`/fr/projects/${projectId}/versions/${versionId}`))?.status()).toBe(404);
    expect((await reader.page.goto(`/fr/projects/${projectId}/versions`))?.status()).toBe(404);
    await reader.close();

    // --- L'étudiante efface le contenu de la première version, soumise par erreur ---
    await page.goto(`/fr/projects/${projectId}/versions`);
    await page.getByTestId("version").last().getByRole("link").click();
    await expect(page.getByTestId("document")).toContainText(`Texte du mémoire ${token}.`);
    await page.getByRole("button", { name: "Effacer le contenu" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await page.getByLabel("J'efface définitivement le contenu de cette version.").check();
    await page.getByRole("button", { name: "Effacer le contenu" }).click();
    await expect(page).toHaveURL(/notice=erased$/);
    await expect(page.getByTestId("version-erased")).toBeVisible();
    await expect(page.getByTestId("document")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Effacer le contenu" })).toHaveCount(0);
    // Le document et le mot d'accompagnement ne sont plus en base ; la trace et la décision restent.
    expect(
      sqlValue(
        `select count(*) from public.thesis_versions where project_id = '${projectId}' and number = 1 and (snapshot::text like '%${token}%' or note is not null)`,
      ),
    ).toBe("0");
    await page.goto(`/fr/projects/${projectId}/versions`);
    await expect(page.getByTestId("version").last()).toContainText("contenu effacé par son auteur");
    await expect(page.getByTestId("version").last().getByTestId("decision")).toContainText(
      `Précisez la problématique ${token}.`,
    );

    // Hors de cet effacement voulu, rien ne modifie ni ne supprime une version ou une décision.
    expect(sqlValue(`select count(*) from public.thesis_versions where project_id = '${projectId}'`)).toBe("2");
    expect(sqlValue(`select count(*) from public.version_decisions where project_id = '${projectId}'`)).toBe("2");
  });

  test("tâches : l'encadreur en propose, l'étudiante les clôt, le lecteur les lit", async ({
    page,
    browser,
  }) => {
    const owner = await createMember("taches-etudiante");
    const supervisor = await createMember("taches-encadreur");
    const viewer = await createMember("taches-lecteur");
    const { projectId, token } = seedProject(owner.id);
    sql(`
      insert into public.research_project_members (project_id, user_id, role) values
        ('${projectId}', '${supervisor.id}', 'supervisor'),
        ('${projectId}', '${viewer.id}', 'viewer')
    `);

    // --- L'encadreur propose une tâche, avec une échéance passée -----------------
    const guide = await openSession(browser, supervisor);
    await guide.page.goto(`/fr/shared/${projectId}`);
    await guide.page.getByRole("link", { name: "Tâches et échéances" }).click();
    await expect(guide.page).toHaveURL(new RegExp(`/fr/shared/${projectId}/tasks$`));
    await expect(guide.page.getByRole("main")).toContainText("Rien à faire pour l'instant.");

    await guide.page.getByRole("button", { name: "Ajouter la tâche" }).click();
    await expect(alert(guide.page)).toHaveText("Certains champs sont à corriger.");
    await guide.page.getByLabel("Ce qu'il faut faire").fill(`Reprendre la problématique ${token}`);
    await guide.page.getByLabel("Échéance (facultatif)").fill("30/11/2026");
    await guide.page.getByRole("button", { name: "Ajouter la tâche" }).click();
    // Le champ fautif est signalé : la réponse est arrivée, la saisie peut reprendre.
    await expect(guide.page.getByLabel("Échéance (facultatif)")).toHaveAttribute("aria-invalid", "true");
    await guide.page.getByLabel("Ce qu'il faut faire").fill(`Reprendre la problématique ${token}`);
    await guide.page.getByLabel("Échéance (facultatif)").fill("2020-01-15");
    await guide.page.getByRole("button", { name: "Ajouter la tâche" }).click();
    await expect(guide.page).toHaveURL(/notice=task-added$/);
    const guideTask = guide.page.getByTestId("task");
    await expect(guideTask).toContainText(`Reprendre la problématique ${token}`);
    await expect(guideTask).toContainText("posée par : l'encadreur");
    await expect(guideTask).toContainText("échéance dépassée depuis le 15 janvier 2020");

    // --- L'étudiante ajoute la sienne, et clôt celle de son encadreur --------------
    await signInThroughForm(page, owner.email, owner.password);
    await expect(page).toHaveURL(/\/fr\/account/);
    await page.goto(`/fr/projects/${projectId}`);
    await page.getByRole("link", { name: "Tâches et échéances" }).click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/tasks$`));
    await expect(page.getByTestId("task")).toHaveCount(1);
    await page.getByLabel("Ce qu'il faut faire").fill(`Rédiger la méthode ${token}`);
    await page.getByRole("button", { name: "Ajouter la tâche" }).click();
    await expect(page).toHaveURL(/notice=task-added$/);
    await expect(page.getByTestId("task")).toHaveCount(2);

    await page
      .getByTestId("task")
      .filter({ hasText: "Reprendre la problématique" })
      .getByRole("button", { name: "Marquer comme faite" })
      .click();
    await expect(page).toHaveURL(/notice=task-done$/);
    await expect(page.getByRole("heading", { name: "1 tâche terminée" })).toBeVisible();
    await expect(
      page.getByTestId("task").filter({ hasText: "Reprendre la problématique" }),
    ).toHaveAttribute("data-done", "true");

    // --- L'encadreur ne modifie que la sienne -------------------------------------
    await guide.page.goto(`/fr/shared/${projectId}/tasks`);
    const studentTask = guide.page.getByTestId("task").filter({ hasText: "Rédiger la méthode" });
    await expect(studentTask).toContainText("posée par : l'auteur du projet");
    await expect(studentTask.getByRole("button")).toHaveCount(0);
    await guide.page
      .getByTestId("task")
      .filter({ hasText: "Reprendre la problématique" })
      .getByRole("button", { name: "Rouvrir" })
      .click();
    await expect(guide.page).toHaveURL(/notice=task-reopened$/);
    await guide.close();

    // --- Le lecteur simple lit, sans rien pouvoir faire ----------------------------
    const reader = await openSession(browser, viewer);
    await reader.page.goto(`/fr/shared/${projectId}/tasks`);
    await expect(reader.page.getByTestId("task")).toHaveCount(2);
    await expect(reader.page.getByRole("main").getByRole("button")).toHaveCount(0);
    expect((await reader.page.goto(`/fr/projects/${projectId}/tasks`))?.status()).toBe(404);
    await reader.close();

    // --- L'étudiante supprime une tâche ---------------------------------------------
    await page.goto(`/fr/projects/${projectId}/tasks`);
    await page
      .getByTestId("task")
      .filter({ hasText: "Reprendre la problématique" })
      .getByRole("button", { name: "Supprimer la tâche" })
      .click();
    await expect(page).toHaveURL(/notice=task-deleted$/);
    await expect(page.getByTestId("task")).toHaveCount(1);
    expect(sqlValue(`select count(*) from public.project_tasks where project_id = '${projectId}'`)).toBe("1");
  });

  test("portée limitée et lien de partage soumis à l'accord du propriétaire", async ({ page, browser }) => {
    const owner = await createMember("portee-etudiante");
    const supervisor = await createMember("portee-encadreur");
    const stranger = await createMember("portee-demandeur");
    const { projectId, sectionId, token } = seedProject(owner.id);
    const closedSectionId = randomUUID();
    sql(`
      insert into public.thesis_sections (id, project_id, position, level, title, body)
        values ('${closedSectionId}', '${projectId}', 2, 1, 'Chapitre réservé', 'Texte réservé ${token}.')
    `);

    await signInThroughForm(page, owner.email, owner.password);
    await expect(page).toHaveURL(/\/fr\/account/);

    // --- Invitation limitée à une section ---------------------------------------
    await page.goto(`/fr/projects/${projectId}/sharing`);
    await page.getByLabel("Adresse électronique de la personne").fill(supervisor.email);
    await page
      .getByRole("group", { name: /Limiter l'accès à ces sections/ })
      .getByLabel("Introduction")
      .check();
    await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
    await expect(page).toHaveURL(/notice=invited$/);
    await expect(page.getByTestId("invitation")).toContainText("accès limité");

    const invitation = await waitForInvitation(supervisor.email);
    const guide = await openSession(browser, supervisor);
    await guide.page.goto(invitation.path);
    await expect(guide.page.getByRole("main")).toContainText("ne vous ouvre que certaines sections");
    await guide.page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(guide.page).toHaveURL(new RegExp(`/fr/shared/${projectId}\\?notice=joined`));

    // --- Ce que lit un membre limité ----------------------------------------------
    await expect(guide.page.getByTestId("limited-access")).toBeVisible();
    await expect(guide.page.getByRole("heading", { level: 1 })).toHaveText(`Mémoire ${token}`);
    // La description détaillée du projet reste réservée à l'accès complet.
    await expect(guide.page.getByRole("main")).not.toContainText(`Problématique ${token}`);
    await expect(guide.page.getByTestId("shared-section")).toHaveText(["Introduction"]);
    await expect(guide.page.getByRole("main")).not.toContainText("Chapitre réservé");
    await expect(guide.page.getByRole("main")).not.toContainText("Texte réservé");
    await expect(guide.page.getByTestId("document")).toHaveCount(0);
    await expect(guide.page.getByRole("link", { name: "Versions soumises et décisions" })).toHaveCount(0);
    await expect(guide.page.getByRole("link", { name: "Tâches et échéances" })).toHaveCount(0);
    for (const path of ["versions", "tasks", `sections/${closedSectionId}`]) {
      expect((await guide.page.goto(`/fr/shared/${projectId}/${path}`))?.status(), path).toBe(404);
    }
    // La section ouverte se lit et se commente.
    await guide.page.goto(`/fr/shared/${projectId}/sections/${sectionId}`);
    await expect(guide.page.getByTestId("section-text")).toContainText(`Texte du mémoire ${token}.`);
    await guide.page.getByLabel("Votre commentaire").fill(`Remarque sur la section ouverte ${token}.`);
    await guide.page.getByRole("button", { name: "Publier le commentaire" }).click();
    await expect(guide.page).toHaveURL(/notice=commented/);

    // --- La propriétaire voit la portée, puis ouvre tout le projet -------------------
    await page.goto(`/fr/projects/${projectId}/sharing`);
    const member = page.getByTestId("member").filter({ hasText: supervisor.email });
    await expect(member).toContainText("accès limité à 1 section");
    await member.getByText("Modifier ce que cette personne peut lire").click();
    // Un accès limité sans aucune section : refusé.
    await member.getByLabel("Introduction").uncheck();
    await member.getByRole("button", { name: "Enregistrer l'accès" }).click();
    await expect(member.getByRole("alert")).toContainText("Cochez au moins une section");
    await member.getByLabel("Accès").selectOption({ label: "Tout le projet" });
    await member.getByRole("button", { name: "Enregistrer l'accès" }).click();
    await expect(page).toHaveURL(/notice=scope-changed$/);
    await expect(page.getByTestId("member").filter({ hasText: supervisor.email })).toContainText("accès complet");

    // Effet immédiat : le document entier, versions et tâches.
    await guide.page.goto(`/fr/shared/${projectId}`);
    await expect(guide.page.getByTestId("limited-access")).toHaveCount(0);
    await expect(guide.page.getByRole("main")).toContainText(`Problématique ${token}`);
    await expect(guide.page.getByTestId("document")).toContainText(`Texte réservé ${token}.`);
    await expect(guide.page.getByRole("link", { name: "Versions soumises et décisions" })).toBeVisible();
    await guide.close();

    // --- Lien de partage : affiché une seule fois ------------------------------------
    await page.getByRole("button", { name: "Créer un lien de partage" }).click();
    const linkField = page.getByTestId("share-link");
    await expect(linkField).toHaveValue(/\/fr\/join\/[0-9a-f]{64}$/);
    const joinPath = new URL(await linkField.inputValue()).pathname;
    const secret = joinPath.split("/").pop() ?? "";
    await page.goto(`/fr/projects/${projectId}/sharing`);
    await expect(page.getByTestId("active-link")).toContainText("Un lien est actif (Lecture seule)");
    expect(await page.content()).not.toContain(secret);
    expect(sqlValue(`select count(*) from public.project_share_links where token_hash = '${secret}'`)).toBe("0");

    // --- Le lien ne donne aucun droit et ne dit rien du projet ------------------------
    const asker = await openSession(browser, stranger);
    await asker.page.goto(joinPath);
    await expect(asker.page.getByRole("heading", { level: 1 })).toHaveText("Demander à suivre un projet");
    await expect(asker.page.getByRole("main")).not.toContainText(token);
    await expect(asker.page.getByRole("main")).toContainText(stranger.email);
    await asker.page.getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(asker.page).toHaveURL(/\/fr\/shared\?notice=requested$/);
    await expect(status(asker.page)).toContainText("Si ce lien est valable, votre demande est envoyée.");
    await expect(asker.page.getByTestId("pending-requests")).toHaveText("1 demande en attente de réponse.");
    await expect(asker.page.getByTestId("shared-project")).toHaveCount(0);
    expect((await asker.page.goto(`/fr/shared/${projectId}`))?.status()).toBe(404);

    // Un lien inconnu reçoit exactement la même réponse, sans créer de demande.
    await asker.page.goto(`/fr/join/${"0".repeat(64)}`);
    await expect(asker.page.getByRole("heading", { level: 1 })).toHaveText("Demander à suivre un projet");
    await asker.page.getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(asker.page).toHaveURL(/\/fr\/shared\?notice=requested$/);
    await expect(asker.page.getByTestId("pending-requests")).toHaveText("1 demande en attente de réponse.");

    // --- La propriétaire est avertie, voit qui demande, et accepte ---------------------
    await page.goto("/fr/notifications");
    await expect(
      page.getByTestId("notification").filter({ hasText: "Quelqu'un demande à suivre" }),
    ).toHaveCount(1);
    await page.getByTestId("notification").filter({ hasText: "Quelqu'un demande à suivre" }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/fr/projects/${projectId}/sharing$`));
    const request = page.getByTestId("access-request");
    await expect(request).toContainText(stranger.email);
    await request.getByRole("button", { name: "Accepter (accès à tout le projet)" }).click();
    await expect(page).toHaveURL(/notice=request-approved$/);
    await expect(page.getByTestId("member").filter({ hasText: stranger.email })).toContainText("Lecture seule");
    await expect(page.getByTestId("access-request")).toHaveCount(0);

    await asker.page.goto("/fr/shared");
    await expect(asker.page.getByTestId("shared-project")).toContainText(`Mémoire ${token}`);
    await expect(asker.page.getByTestId("pending-requests")).toHaveCount(0);
    await asker.close();

    // --- Le lien se désactive -----------------------------------------------------------
    await page.getByRole("button", { name: "Désactiver le lien" }).click();
    await expect(page).toHaveURL(/notice=link-revoked$/);
    await expect(page.getByTestId("active-link")).toHaveCount(0);
  });

  test("les pages de partage exigent une session", async ({ page }) => {
    for (const path of ["/fr/shared", `/fr/shared/${randomUUID()}`, `/fr/projects/${randomUUID()}/sharing`]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/fr\/sign-in/);
    }
  });
});
