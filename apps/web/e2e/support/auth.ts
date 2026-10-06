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
