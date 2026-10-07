import { expect, test, type Browser, type Page } from "@playwright/test";
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
  waitForEmailSubject,
} from "./support/auth";
import { freshTotp } from "./support/totp";

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

/** Ouvre une session au second facteur présenté. */
async function signInWithCode(browser: Browser, member: Member, used: Set<string>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughForm(page, member.email, member.password);
  await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
  await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, used));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/fr\/account/);
  return { page, close: () => context.close() };
}

async function lookup(page: Page, email: string) {
  await page.getByLabel("Adresse électronique du compte").fill(email);
  await page.getByRole("button", { name: "Chercher" }).click();
}

test.describe("administration des rôles et des comptes", () => {
  test.setTimeout(180_000);

  test("un administrateur attribue un rôle, suspend et rétablit un compte", async ({ browser }) => {
    const used = new Set<string>();
    const admin = await createMember("admin");
    makeAdmin(admin.id, "platform_admin");
    const candidate = await createMember("candidate");
    giveSecondFactor(candidate.id);
    const plain = await createMember("sans-facteur");

    const session = await signInWithCode(browser, admin, used);
    const { page } = session;

    await page.getByRole("link", { name: "Administration" }).click();
    await expect(page).toHaveURL(/\/fr\/admin/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Administration");

    // --- Recherche -----------------------------------------------------------
    await lookup(page, "inconnu-" + candidate.email);
    await expect(alert(page)).toHaveText("Aucun compte n'a cette adresse.");
    // L'adresse cherchée ne passe jamais dans l'adresse de la page.
    expect(page.url()).not.toContain("@");

    await lookup(page, candidate.email.toUpperCase());
    const found = page.getByTestId("found-user");
    await expect(found).toContainText(candidate.email);
    await expect(found).toContainText("validation en deux étapes activée");
    await expect(found).toContainText("aucun");
    // Un administrateur ne propose pas le rôle d'administration.
    await expect(found.getByRole("button", { name: /Administration/ })).toHaveCount(0);

    // --- Attribution du rôle de modération -----------------------------------
    await found.getByRole("button", { name: "Attribuer le rôle « Modération »" }).click();
    await expect(page).toHaveURL(/\/fr\/admin\?notice=role-granted/);
    await expect(status(page)).toHaveText("Le rôle est attribué.");
    const row = page.getByTestId("admin-account").filter({ hasText: candidate.email });
    await expect(row).toContainText("Modération");

    // Le rôle est effectif : la candidate voit la modération.
    const moderator = await signInWithCode(browser, candidate, new Set());
    await moderator.page.goto("/fr/moderation");
    await expect(moderator.page.getByRole("heading", { level: 1 })).toHaveText("Modération");
    // ... mais pas l'administration.
    expect((await moderator.page.goto("/fr/admin"))?.status()).toBe(404);

    // --- Compte sans second facteur : pas de rôle ----------------------------
    await lookup(page, plain.email);
    await expect(page.getByTestId("found-user")).toContainText("validation en deux étapes non activée");
    await page.getByTestId("found-user").getByRole("button", { name: "Attribuer le rôle « Modération »" }).click();
    await expect(page.getByTestId("found-user").getByRole("alert")).toContainText(
      "n'a pas activé la validation en deux étapes",
    );

    // --- Suspension : motif exigé, effet immédiat ----------------------------
    await row.getByRole("button", { name: "Suspendre ce compte" }).click();
    await expect(row.getByRole("alert")).toBeVisible();
    await row.getByLabel("Motif").fill("Enquête en cours");
    await row.getByRole("button", { name: "Suspendre ce compte" }).click();
    await expect(page).toHaveURL(/notice=suspended/);
    await expect(row).toContainText("suspendu");
    await expect(row).toContainText("Enquête en cours");
    await expect(status(page)).toContainText("ses sessions sont fermées et il ne peut plus en ouvrir");
    // La personne suspendue est prévenue par courriel : la connexion ne lui dira rien.
    await waitForEmailSubject(candidate.email, "Compte suspendu");

    // La session de la personne suspendue est fermée : elle est renvoyée à la
    // connexion, qui ne lui ouvre plus de session — avec la même réponse qu'à
    // un mot de passe erroné, pour ne rien dire à un tiers.
    await moderator.page.goto("/fr/moderation");
    await expect(moderator.page).toHaveURL(/\/fr\/sign-in/);
    expect(sqlValue(`select count(*) from auth.sessions where user_id = '${candidate.id}'`)).toBe("0");
    await signInThroughForm(moderator.page, candidate.email, candidate.password);
    await expect(moderator.page.getByRole("main").getByRole("alert")).toContainText(
      "Adresse ou mot de passe incorrect",
    );
    await expect(moderator.page).toHaveURL(/\/fr\/sign-in/);
    expect(sqlValue(`select count(*) from auth.sessions where user_id = '${candidate.id}'`)).toBe("0");
    await moderator.close();

    // --- Rétablissement, puis retrait du rôle --------------------------------
    await row.getByRole("button", { name: "Rétablir ce compte" }).click();
    await expect(page).toHaveURL(/notice=restored$/);
    await waitForEmailSubject(candidate.email, "Compte rétabli");
    // La personne rétablie se reconnecte, et retrouve son rôle.
    const restored = await signInWithCode(browser, candidate, new Set());
    await restored.page.goto("/fr/moderation");
    await expect(restored.page.getByRole("heading", { level: 1 })).toHaveText("Modération");
    await row.getByRole("button", { name: "Retirer le rôle « Modération »" }).click();
    await expect(page).toHaveURL(/notice=role-revoked/);
    await expect(page.getByTestId("admin-account").filter({ hasText: candidate.email })).toHaveCount(0);
    expect((await restored.page.goto("/fr/moderation"))?.status()).toBe(404);
    await restored.close();

    // --- Journal d'audit -----------------------------------------------------
    const actions = sqlValue(
      `select string_agg(action, ',' order by action) from (select distinct action from public.audit_logs where actor_id = '${admin.id}') a`,
    );
    for (const action of ["user.lookup", "platform_roles.insert", "platform_roles.delete", "account_status.insert", "account_status.update"]) {
      expect(actions, action).toContain(action);
    }

    // --- Second facteur trop ancien : il est redemandé -----------------------
    // La session garde un jeton dix minutes : on vieillit la présentation du
    // code en attendant un nouveau jeton, ce que le test ne peut pas faire ;
    // la règle est couverte par les tests de la base.
    await session.close();
  });

  test("le super-administrateur gère les administrateurs ; nul n'agit sur soi", async ({ browser }) => {
    const superAdmin = await createMember("super");
    makeAdmin(superAdmin.id, "super_admin");
    const future = await createMember("futur-admin");
    giveSecondFactor(future.id);

    const session = await signInWithCode(browser, superAdmin, new Set());
    const { page } = session;
    try {
      await page.goto("/fr/admin");

    await lookup(page, future.email);
    await page
      .getByTestId("found-user")
      .getByRole("button", { name: "Attribuer le rôle « Administration »" })
      .click();
    await expect(page).toHaveURL(/notice=role-granted/);
    const row = page.getByTestId("admin-account").filter({ hasText: future.email });
    await expect(row).toContainText("Administration");

    // Sur son propre compte : refus de la base.
    await lookup(page, superAdmin.email);
    const own = page.getByTestId("found-user");
    await expect(own).toContainText("Super-administration");
    await expect(own).toContainText("vous ne pouvez ni le suspendre ni le rétablir");
    await own.getByRole("button", { name: "Attribuer le rôle « Modération »" }).click();
    await expect(own.getByRole("alert")).toHaveText("Vous ne pouvez pas agir sur votre propre compte.");

    } finally {
      // Ce compte ne doit pas rester super-administrateur dans la base locale,
      // que le test réussisse ou non.
      sql(`delete from public.platform_roles where user_id in ('${superAdmin.id}', '${future.id}')`);
      await session.close();
    }
  });

  test("l'administration est introuvable pour les autres, et fermée par appel direct", async ({
    page,
    browser,
  }) => {
    // Visiteur : renvoyé à la connexion.
    await page.goto("/fr/admin");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Fadmin/);

    // Utilisateur ordinaire : introuvable, et pas de lien.
    const member = await createMember("pas-admin");
    await signInThroughForm(page, member.email, member.password);
    await expect(page).toHaveURL(/\/fr\/account/);
    await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
    expect((await page.goto("/fr/admin"))?.status()).toBe(404);

    // Administrateur dont la session n'a pas présenté le second facteur :
    // la saisie du code est exigée avant toute page.
    const admin = await createMember("admin-aal1");
    makeAdmin(admin.id, "platform_admin");
    const context = await browser.newContext();
    const other = await context.newPage();
    await signInThroughForm(other, admin.email, admin.password);
    await expect(other).toHaveURL(/\/fr\/sign-in\/verify/);
    await other.goto("/fr/admin");
    await expect(other).toHaveURL(/\/fr\/sign-in\/verify/);
    await context.close();
    sql(`delete from public.platform_roles where user_id = '${admin.id}'`);
  });
});
