import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

// Outils des tests de bout en bout de l'authentification. Ils s'appuient sur
// l'instance Supabase locale et sur sa boîte de réception de test.

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const mailboxUrl = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");

export function requireLocalStack(): void {
  if (!supabaseUrl || !secretKey || !publishableKey || !mailboxUrl) {
    throw new Error(
      "Instance Supabase locale absente : lancer « npm run db:start » puis « npm run test:e2e ».",
    );
  }
}

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 12)}@test.invalid`;
}

export function strongPassword(): string {
  return `Essai-${randomUUID()}`;
}

const admin = () =>
  createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Crée un compte déjà confirmé, sans passer par le courriel. */
export async function createConfirmedUser(email: string, password: string): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("Création du compte de test impossible");
  return data.user.id;
}

/**
 * Inscription faite directement auprès du service d'authentification, sans
 * passer par l'application : c'est ce que ferait un tiers malveillant.
 */
export async function directSignUp(email: string, password: string): Promise<void> {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signUp({ email, password });
  if (error) throw new Error("Inscription directe impossible");
}

type MailboxSummary = { ID: string; Subject: string };

async function messagesFor(email: string): Promise<MailboxSummary[]> {
  const search = await fetch(
    `${mailboxUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const { messages } = (await search.json()) as { messages: MailboxSummary[] };
  return messages;
}

/**
 * Attend le courriel du type voulu destiné à `email` et renvoie le chemin du
 * lien qu'il contient. Les messages sont parcourus du plus récent au plus ancien.
 */
export async function waitForEmailLink(
  email: string,
  type: "email" | "recovery" = "email",
): Promise<string> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    for (const summary of await messagesFor(email)) {
      const message = await fetch(`${mailboxUrl}/api/v1/message/${summary.ID}`);
      const { HTML } = (await message.json()) as { HTML: string };
      const match = /href="([^"]*\/auth\/confirm\?[^"]+)"/.exec(HTML);
      if (!match?.[1]) continue;

      // Seuls le chemin et la requête comptent : l'hôte du lien est celui de
      // la configuration locale, pas celui du serveur de test.
      const url = new URL(match[1].replaceAll("&amp;", "&"));
      if (url.searchParams.get("type") === type) return `${url.pathname}${url.search}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Aucun courriel de type ${type} reçu pour ${email}`);
}

/** Attend un courriel dont l'objet contient le texte donné, et rend son contenu HTML. */
export async function waitForEmailHtml(email: string, text: string): Promise<string> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const summary = (await messagesFor(email)).find(({ Subject }) => Subject.includes(text));
    if (summary) {
      const message = await fetch(`${mailboxUrl}/api/v1/message/${summary.ID}`);
      const { HTML } = (await message.json()) as { HTML: string };
      return HTML;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Aucun courriel « ${text} » reçu pour ${email}`);
}

/** Attend un courriel dont l'objet contient le texte donné. */
export async function waitForEmailSubject(email: string, text: string): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const messages = await messagesFor(email);
    if (messages.some(({ Subject }) => Subject.includes(text))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Aucun courriel « ${text} » reçu pour ${email}`);
}

export async function signInThroughForm(page: Page, email: string, password: string) {
  await page.goto("/fr/sign-in");
  await page.getByLabel("Adresse électronique").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

export async function expectSignedIn(page: Page, email: string) {
  await expect(page).toHaveURL(/\/fr\/account/);
  await expect(page.getByTestId("account-email")).toHaveText(email);
}

/** Vide les compteurs de limitation de débit, pour que les exécutions répétées ne se gênent pas. */
/**
 * Retire les rôles et les suspensions laissés par les exécutions précédentes
 * sur les comptes de test (adresses en « @test.invalid »). Sans cela, la liste
 * d'administration grossit à chaque exécution.
 */
export function resetTestRoles(): void {
  sql(
    `delete from public.platform_roles where user_id in (select id from auth.users where email like '%@test.invalid')`,
  );
  sql(
    `delete from private.account_status where user_id in (select id from auth.users where email like '%@test.invalid')`,
  );
  // Les signalements ouverts des exécutions précédentes : la file de modération
  // n'en montre que cent, les plus anciens d'abord.
  sql(
    `delete from public.resource_reports where reporter_id in (select id from auth.users where email like '%@test.invalid')`,
  );
}

/**
 * Les limites d'essais se comptent par fenêtres fixes d'un quart d'heure. Un
 * test qui compte des essais attend, s'il commence trop près de la fin d'une
 * fenêtre, que la suivante s'ouvre : ses essais tombent alors tous dans la même.
 */
export async function awayFromWindowBoundary(marginSeconds = 60): Promise<void> {
  const windowMs = 15 * 60 * 1000;
  const remaining = windowMs - (Date.now() % windowMs);
  if (remaining < marginSeconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 1000));
  }
}

export function resetRateLimits(): void {
  execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_eduscholar",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-qc",
      "delete from private.rate_limit_buckets",
    ],
    { stdio: "ignore" },
  );
}

/** Exécute une instruction SQL sur l'instance locale, comme le ferait un administrateur de la base. */
export function sql(statement: string): void {
  execFileSync(
    "docker",
    ["exec", "supabase_db_eduscholar", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qc", statement],
    { stdio: "ignore" },
  );
}

/** Exécute une requête et rend sa valeur, en texte. */
export function sqlValue(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "supabase_db_eduscholar", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", statement],
    { encoding: "utf8" },
  ).trim();
}

const UUID = /^[0-9a-f-]{36}$/;

/** Complète le profil minimal d'un compte de test, sans passer par le formulaire. */
export function completeProfileDirectly(userId: string): void {
  if (!UUID.test(userId)) throw new Error("Identifiant invalide");
  sql(
    `update public.profiles set country_code = 'SN', level_code = 'bachelor_3', program_code = 'computer_science', age_confirmed_at = now() where user_id = '${userId}'`,
  );
}

/** Clé de second facteur des modérateurs de test (base32). */
export const TEST_FACTOR_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // valeur-fictive

/** Donne à un compte de test un second facteur vérifié, de clé connue. */
export function giveSecondFactor(userId: string): void {
  if (!UUID.test(userId)) throw new Error("Identifiant invalide");
  sql(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values (gen_random_uuid(), '${userId}', 'test', 'totp', 'verified', now(), now(), '${TEST_FACTOR_SECRET}')`,
  );
}

/**
 * Donne à un compte de test un rôle d'administration et un second facteur
 * vérifié. Le tout premier administrateur d'une plateforme est désigné ainsi,
 * hors application ; les suivants le sont par l'écran d'administration.
 */
export function makeAdmin(userId: string, role: "platform_admin" | "super_admin"): void {
  giveSecondFactor(userId);
  sql(`insert into public.platform_roles (user_id, role) values ('${userId}', '${role}')`);
}

/**
 * Donne à un compte de test le rôle de modérateur et un second facteur vérifié.
 * En production, ces deux opérations sont des actes d'administration (dette D-01).
 */
export function makeModerator(userId: string): void {
  if (!UUID.test(userId)) throw new Error("Identifiant invalide");
  sql(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values (gen_random_uuid(), '${userId}', 'test', 'totp', 'verified', now(), now(), '${TEST_FACTOR_SECRET}')`,
  );
  sql(`insert into public.platform_roles (user_id, role) values ('${userId}', 'moderator')`);
}
