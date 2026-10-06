import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Appel direct à l'API Supabase, sans passer par l'application (modèle de
// menaces M-47, authorization-model §8 « Appel direct »).
//
// Un attaquant n'a pas besoin de l'application : il lui suffit de la clé
// publique, ou de son propre jeton. Ces tests vérifient que la base refuse
// alors ce que l'application refuserait.

const url = process.env.SUPABASE_URL ?? "";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

const run = randomUUID().slice(0, 8);
const password = `Essai-${randomUUID()}`;

type Actor = { id: string; email: string; client: SupabaseClient; token: string };

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createActor(label: string): Promise<Actor> {
  const email = `${label}-${run}@test.invalid`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Création de ${label} impossible`);

  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const session = await client.auth.signInWithPassword({ email, password });
  if (session.error || !session.data.session) throw new Error(`Connexion de ${label} impossible`);

  return { id: created.data.user.id, email, client, token: session.data.session.access_token };
}

/** Requête REST brute, pour contrôler l'en-tête de schéma et le code de retour. */
function rest(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

let alice: Actor;
let bob: Actor;

beforeAll(async () => {
  expect(url, "SUPABASE_URL absent : lancer par « npm run test:integration »").not.toBe("");
  alice = await createActor("alice");
  bob = await createActor("bob");
});

afterAll(async () => {
  for (const actor of [alice, bob]) {
    if (actor) await admin.auth.admin.deleteUser(actor.id);
  }
});

describe("visiteur anonyme, avec la seule clé publique", () => {
  it.each(["profiles", "profile_public", "platform_roles", "organizations", "organization_members", "audit_logs"])(
    "ne lit pas %s",
    async (table) => {
      const { data, error } = await anonymous.from(table).select("*").limit(1);
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    },
  );

  it("n'écrit dans aucune table", async () => {
    const { error } = await anonymous
      .from("profiles")
      .insert({ user_id: randomUUID() } as never);
    expect(error).not.toBeNull();
  });

  it("n'appelle pas la limitation de débit", async () => {
    const { error } = await anonymous.rpc("consume_rate_limit" as never, {
      p_key: "sign-in:ip:attaquant",
      p_limit: 1,
      p_window_seconds: 60,
    } as never);
    expect(error).not.toBeNull();
  });
});

describe("utilisateur authentifié, avec son propre jeton", () => {
  it("un profil est créé à l'inscription, et il ne voit que le sien", async () => {
    const { data, error } = await alice.client.from("profiles").select("user_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: alice.id }]);
  });

  it("ne lit pas le profil d'un autre, même en le visant par son identifiant", async () => {
    const { data, error } = await alice.client
      .from("profiles")
      .select("user_id")
      .eq("user_id", bob.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("modifie sa langue, pas celle d'un autre", async () => {
    const own = await alice.client
      .from("profiles")
      .update({ preferred_locale: "en" })
      .eq("user_id", alice.id)
      .select("preferred_locale");
    expect(own.data).toEqual([{ preferred_locale: "en" }]);

    const other = await alice.client
      .from("profiles")
      .update({ preferred_locale: "en" })
      .eq("user_id", bob.id)
      .select("preferred_locale");
    expect(other.data).toEqual([]);

    const check = await bob.client.from("profiles").select("preferred_locale");
    expect(check.data).toEqual([{ preferred_locale: "fr" }]);
  });

  it("ne peut pas changer le propriétaire de son profil", async () => {
    const response = await rest(`profiles?user_id=eq.${alice.id}`, alice.token, {
      method: "PATCH",
      body: JSON.stringify({ user_id: bob.id }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("ne s'attribue aucun rôle de plateforme", async () => {
    const response = await rest("platform_roles", alice.token, {
      method: "POST",
      body: JSON.stringify({ user_id: alice.id, role: "platform_admin" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);

    const roles = await alice.client.from("platform_roles").select("role");
    expect(roles.data).toEqual([]);
  });

  it("ne crée pas d'organisation et ne s'y ajoute pas", async () => {
    const organization = await rest("organizations", alice.token, {
      method: "POST",
      body: JSON.stringify({ slug: `pirate-${run}`, name: "Organisation pirate" }),
    });
    expect(organization.status).toBeGreaterThanOrEqual(400);

    const membership = await rest("organization_members", alice.token, {
      method: "POST",
      body: JSON.stringify({
        organization_id: randomUUID(),
        user_id: alice.id,
        role: "org_admin",
      }),
    });
    expect(membership.status).toBeGreaterThanOrEqual(400);
  });

  it("n'écrit pas dans le journal d'audit et ne le modifie pas", async () => {
    const insert = await rest("audit_logs", alice.token, {
      method: "POST",
      body: JSON.stringify({ category: "security", action: "faux" }),
    });
    expect(insert.status).toBeGreaterThanOrEqual(400);

    const remove = await rest("audit_logs?id=gt.0", alice.token, { method: "DELETE" });
    expect(remove.status).toBeGreaterThanOrEqual(400);
  });

  it("ne lit pas les colonnes d'acteur privilégié", async () => {
    const response = await rest("organizations?select=created_by", alice.token);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("n'appelle pas la limitation de débit", async () => {
    const response = await rest("rpc/consume_rate_limit", alice.token, {
      method: "POST",
      body: JSON.stringify({ p_key: "sign-in:email:victime", p_limit: 1, p_window_seconds: 60 }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  // Une table qui existe réellement dans chaque schéma : le refus vient donc
  // bien de l'API, pas de l'absence de la table.
  it.each([
    ["private", "account_status"],
    ["auth", "users"],
    ["storage", "buckets"],
    ["graphql_public", "graphql"],
  ])("n'atteint pas le schéma %s par l'API", async (schema, relation) => {
    const response = await rest(`${relation}?select=*`, alice.token, {
      headers: { "Accept-Profile": schema },
    });
    expect(response.status).toBe(406);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("PGRST106");
  });

  it("n'appelle aucune fonction du schéma private", async () => {
    for (const name of ["is_account_active", "has_platform_role", "write_audit"]) {
      const response = await rest(`rpc/${name}`, alice.token, {
        method: "POST",
        body: "{}",
        headers: { "Content-Profile": "private" },
      });
      expect(response.status, name).toBeGreaterThanOrEqual(400);
    }
  });

  it("une réponse est plafonnée par le serveur, quoi que demande le client", async () => {
    const response = await rest("profile_public?select=user_id&limit=100000", alice.token, {
      headers: { Prefer: "count=exact" },
    });
    expect(response.status).toBeLessThan(400);
    const rows = (await response.json()) as unknown[];
    expect(rows.length).toBeLessThanOrEqual(100);
  });
});

describe("jeton falsifié", () => {
  it("un jeton modifié est refusé", async () => {
    const [header, payload, signature] = alice.token.split(".");
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
    const forged = [
      header,
      Buffer.from(JSON.stringify({ ...claims, sub: bob.id, aal: "aal2" })).toString("base64url"),
      signature,
    ].join(".");

    const response = await rest("profiles?select=user_id", forged);
    expect(response.status).toBe(401);
  });

  it("un rôle ajouté par l'utilisateur à ses métadonnées ne donne aucun droit", async () => {
    const updated = await alice.client.auth.updateUser({
      data: { role: "platform_admin", is_admin: true },
    });
    expect(updated.error).toBeNull();

    const refreshed = await alice.client.auth.refreshSession();
    const token = refreshed.data.session?.access_token ?? alice.token;

    const organizations = await rest("organizations?select=id,status&status=neq.verified", token);
    expect(organizations.status).toBeLessThan(400);
    expect(await organizations.json()).toEqual([]);

    const audit = await rest("audit_logs?select=id&category=eq.platform", token);
    expect(await audit.json()).toEqual([]);
  });
});

describe("compte suspendu", () => {
  it("perd l'accès à ses données sans attendre l'expiration de son jeton", async () => {
    const carol = await createActor("carol");
    try {
      const before = await carol.client.from("profiles").select("user_id");
      expect(before.data).toHaveLength(1);

      // La suspension est une opération d'administration : elle sera exposée
      // par une fonction nommée (dette D-01). Ici, elle est posée directement
      // en base, comme le ferait cette fonction.
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
          `insert into private.account_status (user_id, status, reason) values ('${carol.id}', 'suspended', 'test')`,
        ],
        { stdio: "ignore" },
      );

      const after = await carol.client.from("profiles").select("user_id");
      expect(after.error).toBeNull();
      expect(after.data).toEqual([]);
    } finally {
      await admin.auth.admin.deleteUser(carol.id);
    }
  });
});

// Constat de la revue de sécurité, vérifié sur l'instance locale : le jeton des
// liens par courriel est l'empreinte de l'adresse et du code à usage unique.
// Avec un code à 6 chiffres, il se devine en un million d'essais.
describe("jeton des liens reçus par courriel", () => {
  it("ne se déduit pas d'un code à 6 chiffres", async () => {
    const mailbox = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
    expect(mailbox, "MAILPIT_URL absent").not.toBe("");

    const email = `entropie-${run}@test.invalid`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    try {
      await anonymous.auth.resetPasswordForEmail(email);

      let tokenHash = "";
      for (let attempt = 0; attempt < 40 && !tokenHash; attempt += 1) {
        const search = await fetch(
          `${mailbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        if (messages[0]) {
          const message = await fetch(`${mailbox}/api/v1/message/${messages[0].ID}`);
          const { HTML } = (await message.json()) as { HTML: string };
          tokenHash = /token_hash=([A-Za-z0-9_-]+)/.exec(HTML)?.[1] ?? "";
        }
        if (!tokenHash) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(tokenHash).not.toBe("");

      const target = tokenHash.replace(/^pkce_/, "");
      let derivable = false;
      for (let code = 0; code < 1_000_000 && !derivable; code += 1) {
        const candidate = createHash("sha224")
          .update(email + String(code).padStart(6, "0"))
          .digest("hex");
        derivable = candidate === target;
      }
      expect(derivable).toBe(false);
    } finally {
      if (created.data.user) await admin.auth.admin.deleteUser(created.data.user.id);
    }
  });
});

// Profil académique et référentiels, par appel direct (B-11, B-12).
describe("profil académique, par appel direct à l'API", () => {
  let dana: Actor;

  beforeAll(async () => {
    dana = await createActor("dana");
  });

  afterAll(async () => {
    if (dana) await admin.auth.admin.deleteUser(dana.id);
  });

  const patchProfile = (body: Record<string, unknown>) =>
    rest(`profiles?user_id=eq.${dana.id}`, dana.token, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { Prefer: "return=representation" },
    });

  it("un visiteur ne lit aucun référentiel", async () => {
    for (const table of ["countries", "subjects", "education_levels"]) {
      const { data, error } = await anonymous.from(table).select("code").limit(1);
      expect(error, table).not.toBeNull();
      expect(data, table).toBeNull();
    }
  });

  it("un utilisateur lit les référentiels, sans le niveau désactivé", async () => {
    const levels = await dana.client.from("education_levels").select("code");
    expect(levels.error).toBeNull();
    const codes = (levels.data ?? []).map((row) => row.code);
    expect(codes).toContain("bachelor_3");
    expect(codes).not.toContain("upper_secondary");
  });

  it("tant que le profil n'est pas complété, rien ne se publie", async () => {
    const response = await rest(`profile_public?user_id=eq.${dana.id}`, dana.token, {
      method: "PATCH",
      body: JSON.stringify({ display_name: "Sans déclaration", is_public: true }),
      headers: { Prefer: "return=representation" },
    });
    expect(response.status).toBeLessThan(400);
    expect(await response.json()).toEqual([]);

    const check = await dana.client.from("profile_public").select("is_public");
    expect(check.data).toEqual([{ is_public: false }]);
  });

  it.each([
    ["un niveau désactivé", { level_code: "upper_secondary" }],
    ["un pays inconnu", { country_code: "ZZ" }],
    ["une matière sans filière", { subject_codes: ["algorithms"] }],
    ["un objectif hors liste", { goals: ["devenir_admin"] }],
    ["un établissement démesuré", { institution_name: `ab${" ".repeat(5000)}` }],
  ])("la base refuse %s", async (_label, body) => {
    const response = await patchProfile(body);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("la date de complétion et la colonne de propriété ne sont pas modifiables", async () => {
    for (const body of [
      { onboarded_at: "2020-01-01T00:00:00Z" },
      { user_id: alice.id },
      { created_at: "2020-01-01T00:00:00Z" },
    ]) {
      const response = await patchProfile(body);
      expect(response.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
    }
  });

  it("le profil se complète, et la déclaration d'âge est datée par la base", async () => {
    const response = await patchProfile({
      country_code: "SN",
      level_code: "bachelor_3",
      program_code: "computer_science",
      age_confirmed_at: "2001-01-01T00:00:00Z",
    });
    expect(response.status).toBeLessThan(400);
    const [row] = (await response.json()) as Array<{
      age_confirmed_at: string;
      onboarded_at: string | null;
    }>;
    expect(row?.onboarded_at).not.toBeNull();
    expect(new Date(row?.age_confirmed_at ?? 0).getFullYear()).toBeGreaterThanOrEqual(2026);

    // La déclaration ne se retire pas.
    await patchProfile({ age_confirmed_at: null });
    const check = await dana.client.from("profiles").select("age_confirmed_at");
    expect(check.data?.[0]?.age_confirmed_at).not.toBeNull();
  });

  it("un autre utilisateur ne lit pas ce profil, même par imbrication", async () => {
    const direct = await alice.client.from("profiles").select("country_code").eq("user_id", dana.id);
    expect(direct.data).toEqual([]);

    const nested = await rest("countries?select=code,profiles(user_id,institution_name)&code=eq.SN", alice.token);
    if (nested.status < 400) {
      const rows = (await nested.json()) as Array<{ profiles: unknown[] }>;
      for (const row of rows) expect(row.profiles).toEqual([]);
    }
  });

  it("le contrôle de suppression n'est pas appelable par un visiteur", async () => {
    const { error } = await anonymous.rpc("account_deletion_check" as never);
    expect(error).not.toBeNull();
  });
});
