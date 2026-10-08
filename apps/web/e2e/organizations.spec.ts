import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  giveSecondFactor,
  makeAdmin,
  signInThroughForm,
  sql,
  sqlValue,
  strongPassword,
  TEST_FACTOR_SECRET,
  uniqueEmail,
  waitForEmailHtml,
} from "./support/auth";
import { freshTotp } from "./support/totp";

// Organisations : administration par la plateforme, invitation du premier
// administrateur, vie des membres, isolation entre organisations.

// Une adresse de client propre à ce fichier : ses connexions ne pèsent pas sur
// la limite par adresse que se partagent les autres parcours.
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.23" } });

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

/**
 * Nom et identifiant d'adresse d'une organisation de test. La liste
 * d'administration est triée par identifiant : celui-ci commence par un
 * compteur décroissant, pour que l'organisation la plus récente soit toujours
 * sur la première page, quel que soit le nombre d'exécutions passées.
 */
function organizationNames(label: string) {
  const tag = randomUUID().slice(0, 8);
  return {
    name: `Organisation ${label} ${tag}`,
    slug: `0${String(9_999_999_999_999 - Date.now())}-${label}-${tag}`,
  };
}

/** Une organisation créée hors application, avec ses membres. */
function seedOrganization(
  label: string,
  state: "pending" | "verified",
  members: { user: Member; role: "org_admin" | "member" }[] = [],
) {
  const id = randomUUID();
  const { name, slug } = organizationNames(label);
  sql(`insert into public.organizations (id, slug, name, status) values ('${id}', '${slug}', '${name}', '${state}')`);
  for (const { user, role } of members) {
    sql(
      `insert into public.organization_members (organization_id, user_id, role) values ('${id}', '${user.id}', '${role}')`,
    );
  }
  return { id, name, slug };
}

/** Retire une organisation de test de la base locale, sans faire échouer le test. */
function dropOrganization(id: string) {
  try {
    sql(`
      update public.organizations set status = 'suspended' where id = '${id}';
      select set_config('eduscholar.organization_dissolution', '${id}', true);
      delete from public.organization_members where organization_id = '${id}';
      delete from public.organizations where id = '${id}'
    `);
  } catch {
    // Le ménage est un confort : la liste reste lisible sans lui.
  }
}

/** Le volet repliable d'une ligne, ouvert. */
async function openPanel(row: Locator, summary: string): Promise<Locator> {
  const panel = row.locator("details").filter({ has: row.page().locator("summary", { hasText: summary }) });
  await panel.locator("summary").click();
  return panel;
}

/** Attend l'invitation à rejoindre une organisation, et rend son contenu et le chemin de son lien. */
async function waitForOrgInvitation(email: string, nth = 0): Promise<{ html: string; path: string }> {
  const html = await waitForEmailHtml(email, "Invitation à rejoindre une organisation", nth);
  const match = /href="[^"]*(\/[a-z]{2}\/organizations\/invitations\/[0-9a-f]{64})"/.exec(html);
  if (!match?.[1]) throw new Error("Invitation d'organisation sans lien");
  return { html, path: match[1] };
}

test.describe("organisations", () => {
  test.setTimeout(240_000);

  test("création, premier administrateur, membres : invitation, rôle, retrait", async ({ browser }) => {
    const platformAdmin = await createMember("org-plateforme");
    makeAdmin(platformAdmin.id, "platform_admin");
    const orgAdmin = await createMember("org-admin");
    giveSecondFactor(orgAdmin.id);
    const member = await createMember("org-membre");
    const { name, slug } = organizationNames("parcours");
    let organizationId = "";

    const platform = await openSessionWithCode(browser, platformAdmin);
    const { page } = platform;
    try {
      // --- La plateforme crée l'organisation --------------------------------------
      await page.getByRole("link", { name: "Administration" }).click();
      await page.getByRole("link", { name: "Administrer les organisations" }).click();
      await expect(page).toHaveURL(/\/fr\/admin\/organizations$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Organisations");
      // La règle de reprise est dite en une phrase.
      await expect(page.getByTestId("recovery-rule")).toContainText(
        "réservée à un super-administrateur autre que celui qui a prononcé la suspension",
      );

      await page.getByLabel("Nom").last().fill(name);
      await page.getByLabel("Identifiant d'adresse").last().fill("Pas Valide");
      await page.getByRole("button", { name: "Créer l'organisation" }).click();
      await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
      await expect(page.getByLabel("Identifiant d'adresse").last()).toHaveAttribute("aria-invalid", "true");

      await page.getByLabel("Nom").last().fill(name);
      await page.getByLabel("Identifiant d'adresse").last().fill(slug);
      await page.getByRole("button", { name: "Créer l'organisation" }).click();
      await expect(page).toHaveURL(/notice=created$/);
      await expect(status(page)).toHaveText("L'organisation est créée, en attente de vérification.");

      const row = page.getByTestId("organization").filter({ hasText: slug });
      await expect(row).toContainText(name);
      await expect(row.getByTestId("organization-status")).toHaveText("En attente de vérification");
      await expect(row.getByTestId("organization-counts")).toHaveText("aucun membre, dont aucun administrateur");

      // Le même identifiant ne sert pas deux fois.
      await page.getByLabel("Nom").last().fill(`${name} bis`);
      await page.getByLabel("Identifiant d'adresse").last().fill(slug);
      await page.getByRole("button", { name: "Créer l'organisation" }).click();
      await expect(alert(page)).toContainText("déjà pris par une autre organisation");

      // --- Elle invite le premier administrateur -----------------------------------
      const invite = await openPanel(row, "Inviter le premier administrateur");
      await invite.getByLabel("Adresse électronique du futur administrateur").fill(platformAdmin.email);
      await invite.getByRole("button", { name: "Envoyer l'invitation" }).click();
      await expect(invite.getByRole("alert")).toContainText("propre compte");

      await invite.getByLabel("Adresse électronique du futur administrateur").fill(orgAdmin.email.toUpperCase());
      await invite.getByRole("button", { name: "Envoyer l'invitation" }).click();
      await expect(page).toHaveURL(/notice=admin-invited$/);
      await expect(status(page)).toHaveText("L'invitation est envoyée.");
      // Ni l'adresse invitée ni le jeton ne passent dans l'adresse de la page.
      expect(page.url()).not.toContain("@");

      const invitation = await waitForOrgInvitation(orgAdmin.email);
      const secret = invitation.path.split("/").pop() ?? "";
      expect(page.url()).not.toContain(secret);
      expect(await page.content()).not.toContain(secret);
      // Le courriel ne nomme pas l'organisation ; un seul lien, répété dans chaque langue.
      expect(invitation.html).not.toContain(name);
      expect(invitation.html).not.toContain(slug);
      expect(invitation.html.match(/href="/g)).toHaveLength(2);
      // La base ne garde que l'empreinte du jeton.
      expect(
        sqlValue(`select count(*) from public.organization_invitations where token_hash = '${secret}'`),
      ).toBe("0");

      await row.getByRole("button", { name: "Vérifier cette organisation" }).click();
      await expect(page).toHaveURL(/notice=verified$/);
      await expect(row.getByTestId("organization-status")).toHaveText("Vérifiée");

      // --- Le lien seul ne donne rien ----------------------------------------------
      const anonymous = await browser.newContext();
      const visitor = await anonymous.newPage();
      await visitor.goto(invitation.path);
      await expect(visitor).toHaveURL(/\/fr\/sign-in/);
      await anonymous.close();

      const invited = await openSession(browser, member);
      await invited.page.goto(invitation.path);
      await expect(alert(invited.page)).toContainText("n'est pas valable pour le compte");
      await expect(invited.page.getByRole("main")).not.toContainText(name);
      await expect(invited.page.getByRole("button", { name: "Accepter l'invitation" })).toHaveCount(0);
      await invited.page.goto("/fr/organizations");
      await expect(invited.page.getByRole("main")).toContainText("Vous n'êtes membre d'aucune organisation.");

      // --- La personne invitée accepte, second facteur présenté ----------------------
      const manager = await openSessionWithCode(browser, orgAdmin);
      await manager.page.goto(invitation.path);
      await expect(manager.page.getByTestId("org-invitation-preview")).toContainText(name);
      await expect(manager.page.getByTestId("org-invitation-preview")).toContainText(
        "Administration de l'organisation",
      );
      await expect(manager.page.getByRole("main")).toContainText("Ce rôle exige la validation en deux étapes");
      await manager.page.getByRole("button", { name: "Accepter l'invitation" }).click();
      await expect(manager.page).toHaveURL(/\/fr\/organizations\?notice=joined$/);
      await expect(status(manager.page)).toHaveText("Vous avez rejoint l'organisation.");
      const mine = manager.page.getByTestId("my-organization").filter({ hasText: name });
      await expect(mine).toContainText("Administration de l'organisation");
      await expect(mine).toContainText("Vérifiée");

      // Le lien ne sert qu'une fois.
      await manager.page.goto(invitation.path);
      await expect(alert(manager.page)).toContainText("n'est pas valable pour le compte");

      // --- L'administrateur de l'organisation invite un membre ------------------------
      await manager.page.goto("/fr/organizations");
      await mine.getByRole("link", { name: "Administrer cette organisation" }).click();
      await expect(manager.page).toHaveURL(/\/fr\/organizations\/[0-9a-f-]{36}$/);
      organizationId = manager.page.url().split("/").pop() ?? "";
      await expect(manager.page.getByRole("heading", { level: 1 })).toHaveText(name);
      await expect(manager.page.getByTestId("org-member")).toHaveCount(1);
      await expect(manager.page.getByTestId("org-member")).toContainText(orgAdmin.email);
      await expect(manager.page.getByRole("main")).toContainText("Aucune invitation en attente.");

      await manager.page.getByLabel("Adresse électronique de la personne").fill("pas-une-adresse");
      await manager.page.getByRole("button", { name: "Envoyer l'invitation" }).click();
      await expect(alert(manager.page)).toHaveText("Certains champs sont à corriger.");

      await manager.page.getByLabel("Adresse électronique de la personne").fill(member.email);
      await manager.page.getByLabel("Son rôle").selectOption({ label: "Membre" });
      await manager.page.getByRole("button", { name: "Envoyer l'invitation" }).click();
      await expect(manager.page).toHaveURL(/notice=invited$/);
      await expect(status(manager.page)).toHaveText("L'invitation est envoyée.");
      await expect(manager.page.getByTestId("org-invitation")).toContainText(member.email);
      expect(manager.page.url()).not.toContain("@");

      const memberInvitation = await waitForOrgInvitation(member.email);
      expect(await manager.page.content()).not.toContain(memberInvitation.path.split("/").pop() ?? "");
      expect(memberInvitation.html).not.toContain(name);

      await invited.page.goto(memberInvitation.path);
      await expect(invited.page.getByTestId("org-invitation-preview")).toContainText(name);
      await expect(invited.page.getByTestId("org-invitation-preview")).toContainText("Membre");
      await invited.page.getByRole("button", { name: "Accepter l'invitation" }).click();
      await expect(invited.page).toHaveURL(/\/fr\/organizations\?notice=joined$/);
      const membership = invited.page.getByTestId("my-organization").filter({ hasText: name });
      await expect(membership).toContainText("Membre");
      // Un membre ordinaire n'administre rien : ni lien, ni page.
      await expect(membership.getByRole("link", { name: "Administrer cette organisation" })).toHaveCount(0);
      expect((await invited.page.goto(`/fr/organizations/${organizationId}`))?.status()).toBe(404);

      // --- Changer le rôle, puis retirer -----------------------------------------------
      await manager.page.goto(`/fr/organizations/${organizationId}`);
      await expect(manager.page.getByTestId("org-invitation")).toHaveCount(0);
      const memberRow = manager.page.getByTestId("org-member").filter({ hasText: member.email });
      await expect(memberRow.getByTestId("org-member-role")).toHaveText("Membre");
      await memberRow.getByLabel(`Rôle de ${member.email}`).selectOption({ label: "Enseignant" });
      await memberRow.getByRole("button", { name: "Changer le rôle" }).click();
      await expect(manager.page).toHaveURL(/notice=role-changed$/);
      await expect(status(manager.page)).toHaveText("Le rôle est modifié.");
      await expect(memberRow.getByTestId("org-member-role")).toHaveText("Enseignant");

      // Le rôle d'administration ne va pas à un compte sans second facteur : refus de la base.
      await memberRow
        .getByLabel(`Rôle de ${member.email}`)
        .selectOption({ label: "Administration de l'organisation" });
      await memberRow.getByRole("button", { name: "Changer le rôle" }).click();
      await expect(memberRow.getByRole("alert")).toContainText("n'a pas activé la validation en deux étapes");

      // La plateforme lit des nombres, jamais la liste des membres.
      await page.goto("/fr/admin/organizations");
      await expect(row.getByTestId("organization-counts")).toHaveText("2 membres, dont 1 administrateur");
      await expect(row).not.toContainText(member.email);
      // L'organisation a son administrateur : la plateforme n'en invite plus.
      await expect(row.locator("summary", { hasText: "Inviter le premier administrateur" })).toHaveCount(0);

      await manager.page.goto(`/fr/organizations/${organizationId}`);
      await memberRow.getByRole("button", { name: "Retirer cette personne" }).click();
      await expect(manager.page).toHaveURL(/notice=removed$/);
      await expect(manager.page.getByTestId("org-member")).toHaveCount(1);
      // Effet immédiat pour la personne retirée.
      await invited.page.goto("/fr/organizations");
      await expect(invited.page.getByTestId("my-organization")).toHaveCount(0);

      // Le dernier administrateur ne quitte pas l'organisation.
      await manager.page.goto("/fr/organizations");
      await mine.getByText("Quitter cette organisation").click();
      await mine.getByRole("button", { name: "Quitter", exact: true }).click();
      await expect(mine.getByRole("alert")).toHaveText("Certains champs sont à corriger.");
      await mine.getByLabel("Je quitte cette organisation.").check();
      await mine.getByRole("button", { name: "Quitter", exact: true }).click();
      await expect(mine.getByRole("alert")).toContainText("seul administrateur");

      await invited.close();
      await manager.close();

      // --- Journal d'audit ---------------------------------------------------------------
      const actions = sqlValue(
        `select string_agg(distinct action, ',') from public.audit_logs where organization_id = '${organizationId}'`,
      );
      for (const action of [
        "organization.admin_invited",
        "organization.admin_invitation_accepted",
        "organization.member_invited",
      ]) {
        expect(actions, action).toContain(action);
      }
    } finally {
      sql(`delete from public.platform_roles where user_id = '${platformAdmin.id}'`);
      if (organizationId) dropOrganization(organizationId);
      await platform.close();
    }
  });

  test("isolation : la page d'administration est introuvable hors de son administrateur", async ({
    page,
    browser,
  }) => {
    const adminA = await createMember("org-iso-admin-a");
    giveSecondFactor(adminA.id);
    const adminB = await createMember("org-iso-admin-b");
    giveSecondFactor(adminB.id);
    const plain = await createMember("org-iso-membre");
    const outsider = await createMember("org-iso-tiers");
    const first = seedOrganization("iso-a", "verified", [
      { user: adminA, role: "org_admin" },
      { user: plain, role: "member" },
    ]);
    const second = seedOrganization("iso-b", "verified", [{ user: adminB, role: "org_admin" }]);

    try {
      // Visiteur : renvoyé à la connexion.
      await page.goto(`/fr/organizations/${first.id}`);
      await expect(page).toHaveURL(/\/fr\/sign-in/);
      await page.goto("/fr/organizations");
      await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Forganizations/);

      // Compte étranger à l'organisation.
      const stranger = await openSession(browser, outsider);
      expect((await stranger.page.goto(`/fr/organizations/${first.id}`))?.status()).toBe(404);
      await stranger.close();

      // Membre ordinaire : il voit son appartenance, pas l'administration.
      const ordinary = await openSession(browser, plain);
      await ordinary.page.getByRole("link", { name: "Mes organisations" }).click();
      await expect(ordinary.page).toHaveURL(/\/fr\/organizations$/);
      const membership = ordinary.page.getByTestId("my-organization");
      await expect(membership).toHaveCount(1);
      await expect(membership).toContainText(first.name);
      await expect(ordinary.page.getByRole("main")).not.toContainText(second.name);
      await expect(ordinary.page.getByRole("link", { name: "Administrer cette organisation" })).toHaveCount(0);
      expect((await ordinary.page.goto(`/fr/organizations/${first.id}`))?.status()).toBe(404);
      expect((await ordinary.page.goto(`/fr/organizations/${second.id}`))?.status()).toBe(404);

      // Il la quitte, après confirmation.
      await ordinary.page.goto("/fr/organizations");
      await membership.getByText("Quitter cette organisation").click();
      await membership.getByRole("button", { name: "Quitter", exact: true }).click();
      await expect(membership.getByRole("alert")).toHaveText("Certains champs sont à corriger.");
      await membership.getByLabel("Je quitte cette organisation.").check();
      await membership.getByRole("button", { name: "Quitter", exact: true }).click();
      await expect(ordinary.page).toHaveURL(/\/fr\/organizations\?notice=left$/);
      await expect(status(ordinary.page)).toHaveText("Vous avez quitté l'organisation.");
      await expect(ordinary.page.getByTestId("my-organization")).toHaveCount(0);
      await ordinary.close();

      // Administrateur d'une AUTRE organisation : la sienne s'ouvre, pas celle-ci.
      const other = await openSessionWithCode(browser, adminB);
      expect((await other.page.goto(`/fr/organizations/${first.id}`))?.status()).toBe(404);
      expect((await other.page.goto(`/fr/organizations/${randomUUID()}`))?.status()).toBe(404);
      expect((await other.page.goto("/fr/organizations/pas-un-identifiant"))?.status()).toBe(404);
      expect((await other.page.goto(`/fr/organizations/${second.id}`))?.status()).toBe(200);
      await expect(other.page.getByRole("heading", { level: 1 })).toHaveText(second.name);
      await expect(other.page.getByTestId("org-member")).toHaveCount(1);
      await expect(other.page.getByRole("main")).not.toContainText(adminA.email);
      // Sur son propre compte, pas d'action : on part par « Mes organisations ».
      await expect(other.page.getByRole("button", { name: "Retirer cette personne" })).toHaveCount(0);

      // Une organisation suspendue n'a plus d'administration ; on peut encore la quitter.
      sql(`update public.organizations set status = 'suspended' where id = '${second.id}'`);
      expect((await other.page.goto(`/fr/organizations/${second.id}`))?.status()).toBe(404);
      await other.page.goto("/fr/organizations");
      await expect(other.page.getByTestId("my-organization")).toContainText("Suspendue");
      await expect(other.page.getByRole("link", { name: "Administrer cette organisation" })).toHaveCount(0);
      await other.close();

      // Une invitation inconnue, bien formée : même message que les autres refus.
      const admin = await openSessionWithCode(browser, adminA);
      await admin.page.goto(`/fr/organizations/invitations/${"0".repeat(64)}`);
      await expect(alert(admin.page)).toContainText("n'est pas valable pour le compte");
      await admin.close();
    } finally {
      dropOrganization(first.id);
      dropOrganization(second.id);
    }
  });

  test("suspension avec motif, rétablissement avec motif, dissolution confirmée", async ({ browser }) => {
    const platformAdmin = await createMember("org-etat-plateforme");
    makeAdmin(platformAdmin.id, "platform_admin");
    const organization = seedOrganization("etat", "verified");

    const session = await openSessionWithCode(browser, platformAdmin);
    const { page } = session;
    try {
      await page.goto("/fr/admin/organizations");
      const row = page.getByTestId("organization").filter({ hasText: organization.slug });
      await expect(row.getByTestId("organization-status")).toHaveText("Vérifiée");

      // --- Suspendre : motif exigé ----------------------------------------------------
      let panel = await openPanel(row, "Suspendre cette organisation");
      await panel.getByRole("button", { name: "Suspendre", exact: true }).click();
      await expect(panel.getByRole("alert")).toContainText("Un motif est nécessaire");
      await panel.getByLabel("Motif").fill("Vérification des statuts en cours");
      await panel.getByRole("button", { name: "Suspendre", exact: true }).click();
      await expect(page).toHaveURL(/notice=suspended$/);
      await expect(status(page)).toContainText("L'organisation est suspendue");
      await expect(row.getByTestId("organization-status")).toHaveText("Suspendue");
      await expect(row).toContainText("Vérification des statuts en cours");
      // Aucune invitation de reprise n'a été émise.
      await expect(row.getByTestId("recovery-signal")).toHaveCount(0);

      // La reprise n'est pas ouverte à un administrateur simple : refus de la base.
      panel = await openPanel(row, "Inviter un administrateur de reprise");
      await panel.getByLabel("Adresse électronique du futur administrateur").fill(uniqueEmail("org-reprise"));
      await panel.getByRole("button", { name: "Envoyer l'invitation" }).click();
      await expect(panel.getByRole("alert")).toHaveText("Vous n'avez pas le droit de faire cette action.");

      // --- Rétablir : motif exigé -------------------------------------------------------
      panel = await openPanel(row, "Rétablir cette organisation");
      await panel.getByRole("button", { name: "Rétablir", exact: true }).click();
      await expect(panel.getByRole("alert")).toContainText("Un motif est nécessaire");
      await panel.getByLabel("Motif").fill("Statuts vérifiés");
      await panel.getByRole("button", { name: "Rétablir", exact: true }).click();
      await expect(page).toHaveURL(/notice=restored$/);
      await expect(status(page)).toHaveText("L'organisation est rétablie.");
      await expect(row.getByTestId("organization-status")).toHaveText("Vérifiée");
      await expect(row).not.toContainText("Vérification des statuts en cours");

      // --- Renommer une organisation vérifiée : avertie, elle repasse en attente ----------
      panel = await openPanel(row, "Renommer");
      await expect(panel).toContainText("elle repassera « en attente de vérification »");
      await panel.getByLabel("Nom").fill(`${organization.name} renommée`);
      await panel.getByRole("button", { name: "Enregistrer le nouveau nom" }).click();
      await expect(page).toHaveURL(/notice=renamed$/);
      await expect(row).toContainText(`${organization.name} renommée`);
      await expect(row.getByTestId("organization-status")).toHaveText("En attente de vérification");

      // --- Dissoudre : seulement suspendue, motif et confirmation -------------------------
      await expect(row.locator("summary", { hasText: "Dissoudre cette organisation" })).toHaveCount(0);
      panel = await openPanel(row, "Suspendre cette organisation");
      await panel.getByLabel("Motif").fill("Fermeture de l'établissement");
      await panel.getByRole("button", { name: "Suspendre", exact: true }).click();
      await expect(page).toHaveURL(/notice=suspended$/);

      panel = await openPanel(row, "Dissoudre cette organisation");
      await panel.getByLabel("Motif").fill("Fermeture de l'établissement");
      await panel.getByRole("button", { name: "Dissoudre définitivement" }).click();
      await expect(panel.getByRole("alert")).toHaveText("Certains champs sont à corriger.");
      await panel.getByLabel("Motif").fill("Fermeture de l'établissement");
      await panel.getByLabel("Je dissous définitivement cette organisation.").check();
      await panel.getByRole("button", { name: "Dissoudre définitivement" }).click();
      await expect(page).toHaveURL(/notice=dissolved$/);
      await expect(status(page)).toHaveText("L'organisation est dissoute.");
      await expect(page.getByTestId("organization").filter({ hasText: organization.slug })).toHaveCount(0);
      expect(sqlValue(`select count(*) from public.organizations where id = '${organization.id}'`)).toBe("0");
    } finally {
      sql(`delete from public.platform_roles where user_id = '${platformAdmin.id}'`);
      dropOrganization(organization.id);
      await session.close();
    }
  });

  test("l'administration des organisations est introuvable sans rôle", async ({ page, browser }) => {
    // Visiteur : renvoyé à la connexion.
    await page.goto("/fr/admin/organizations");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Fadmin%2Forganizations/);

    // Utilisateur sans rôle : introuvable.
    const member = await createMember("org-sans-role");
    await signInThroughForm(page, member.email, member.password);
    await expect(page).toHaveURL(/\/fr\/admin\/organizations|\/fr\/account/);
    expect((await page.goto("/fr/admin/organizations"))?.status()).toBe(404);

    // Administrateur d'organisation, second facteur présenté : pas davantage.
    const orgAdmin = await createMember("org-pas-plateforme");
    giveSecondFactor(orgAdmin.id);
    const organization = seedOrganization("sans-role", "verified", [{ user: orgAdmin, role: "org_admin" }]);
    try {
      const session = await openSessionWithCode(browser, orgAdmin);
      expect((await session.page.goto("/fr/admin/organizations"))?.status()).toBe(404);
      await session.close();
    } finally {
      dropOrganization(organization.id);
    }
  });
});
