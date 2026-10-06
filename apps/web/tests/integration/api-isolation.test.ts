import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
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

// Second facteur imposé en base (modèle de menaces M-48), par appel direct.
describe("compte avec second facteur, par appel direct à l'API", () => {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function totp(secret: string): string {
    let bits = "";
    for (const char of secret.replace(/=+$/, "").toUpperCase()) {
      bits += ALPHABET.indexOf(char).toString(2).padStart(5, "0");
    }
    const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac("sha1", key).update(counter).digest();
    const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  }

  it("une session ouverte par le seul mot de passe n'obtient plus rien", async () => {
    const erin = await createActor("erin");
    try {
      // Avant l'activation : le profil est lisible.
      expect((await erin.client.from("profiles").select("user_id")).data).toHaveLength(1);

      const enrollment = await erin.client.auth.mfa.enroll({ factorType: "totp" });
      if (enrollment.error || enrollment.data.type !== "totp") throw new Error("activation impossible");
      const verified = await erin.client.auth.mfa.challengeAndVerify({
        factorId: enrollment.data.id,
        code: totp(enrollment.data.totp.secret),
      });
      expect(verified.error).toBeNull();

      // Session où le second facteur est vérifié : accès normal.
      expect((await erin.client.from("profiles").select("user_id")).data).toHaveLength(1);

      // Nouvelle session par mot de passe seul, comme un attaquant qui le connaît.
      const attacker = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const session = await attacker.auth.signInWithPassword({ email: erin.email, password });
      expect(session.error).toBeNull();

      const profile = await attacker.from("profiles").select("user_id");
      expect(profile.error).toBeNull();
      expect(profile.data).toEqual([]);

      const update = await attacker
        .from("profiles")
        .update({ preferred_locale: "en" })
        .eq("user_id", erin.id)
        .select("user_id");
      expect(update.data).toEqual([]);

      const countries = await attacker.from("countries").select("code").limit(1);
      expect(countries.data).toEqual([]);

      const deletion = await attacker.rpc("account_deletion_check" as never);
      expect(deletion.data).toBe("forbidden");
    } finally {
      await admin.auth.admin.deleteUser(erin.id);
    }
  });
});

// Catalogue (B-13), par appel direct à l'API.
describe("catalogue, par appel direct à l'API", () => {
  let fatou: Actor;
  let resourceId = "";

  const payload = (overrides: Record<string, unknown> = {}) => ({
    type_code: "article",
    title: `Ressource de test ${run}`,
    authors: ["Fatou Sow"],
    language_code: "fr",
    program_code: "computer_science",
    official_url: "https://exemple.invalid/ressource",
    access_status: "open_access",
    license_code: "cc-by-4.0",
    rights_declared: true,
    ...overrides,
  });

  beforeAll(async () => {
    fatou = await createActor("fatou");
    // Profil complété, comme le ferait le formulaire.
    const completed = await fatou.client
      .from("profiles")
      .update({
        country_code: "SN",
        level_code: "bachelor_3",
        program_code: "computer_science",
        age_confirmed_at: new Date().toISOString(),
      })
      .eq("user_id", fatou.id)
      .select("user_id");
    expect(completed.data).toHaveLength(1);
  });

  afterAll(async () => {
    if (fatou) await admin.auth.admin.deleteUser(fatou.id);
  });

  it("un visiteur ne lit ni ne propose rien", async () => {
    expect((await anonymous.from("resources").select("id").limit(1)).error).not.toBeNull();
    expect((await anonymous.rpc("submit_resource" as never, { payload: payload() } as never)).error).not.toBeNull();
  });

  it("aucune écriture directe dans les tables du catalogue", async () => {
    const insert = await rest("resources", fatou.token, {
      method: "POST",
      body: JSON.stringify({
        type_code: "article",
        title: "Insertion directe",
        language_code: "fr",
        program_code: "computer_science",
        source_kind: "connector",
        source_name: "openalex",
        editorial_status: "published",
      }),
    });
    expect(insert.status).toBeGreaterThanOrEqual(400);

    for (const table of ["resource_internal", "resource_status_history", "resource_reports"]) {
      const response = await rest(table, fatou.token, { method: "POST", body: "{}" });
      expect(response.status, table).toBeGreaterThanOrEqual(400);
    }
  });

  it("un compte qui n'a pas complété son profil ne propose rien", async () => {
    const { error } = await alice.client.rpc("submit_resource" as never, { payload: payload() } as never);
    expect(error?.message).toBe("forbidden");
  });

  it("une proposition est créée en attente, quels que soient les champs envoyés", async () => {
    const { data, error } = await fatou.client.rpc("submit_resource" as never, {
      payload: payload({
        editorial_status: "published",
        visibility: "organization",
        source_kind: "connector",
        source_name: "openalex",
        submitted_by: alice.id,
        published_at: "2020-01-01T00:00:00Z",
      }),
    } as never);
    expect(error).toBeNull();
    resourceId = data as unknown as string;

    const row = await fatou.client
      .from("resources")
      .select("editorial_status, visibility, source_kind, source_name, published_at")
      .eq("id", resourceId);
    expect(row.data).toEqual([
      {
        editorial_status: "pending",
        visibility: "public",
        source_kind: "contribution",
        source_name: "contribution",
        published_at: null,
      },
    ]);
  });

  it("l'identité du contributeur et les notes internes ne sont pas lisibles", async () => {
    const identity = await rest(`resources?select=submitted_by&id=eq.${resourceId}`, fatou.token);
    expect(identity.status).toBeGreaterThanOrEqual(400);

    const notes = await fatou.client.from("resource_internal").select("resource_id");
    expect(notes.data).toEqual([]);
  });

  it("un autre utilisateur ne voit pas la proposition en attente et ne peut pas la modifier", async () => {
    const read = await bob.client.from("resources").select("id").eq("id", resourceId);
    expect(read.data).toEqual([]);

    const update = await bob.client.rpc("update_submission" as never, {
      resource_id: resourceId,
      payload: payload({ title: "Détournée" }),
    } as never);
    // Refus dans tous les cas : ce compte n'a pas complété son profil, et la
    // proposition n'est de toute façon pas la sienne.
    expect(["forbidden", "not_found"]).toContain(update.error?.message);

    const patch = await rest(`resources?id=eq.${resourceId}`, bob.token, {
      method: "PATCH",
      body: JSON.stringify({ editorial_status: "published" }),
    });
    expect(patch.status).toBeGreaterThanOrEqual(400);
  });

  it("sans le rôle de modérateur, aucune décision n'est possible, même sur sa propre proposition", async () => {
    for (const action of ["start_review", "verify", "publish", "remove"]) {
      const { error } = await fatou.client.rpc("moderate_resource" as never, {
        resource_id: resourceId,
        action,
      } as never);
      expect(error?.message, action).toBe("forbidden");
    }
    const edit = await fatou.client.rpc("moderator_update_resource" as never, {
      resource_id: resourceId,
      payload: { license_code: "cc0-1.0" },
    } as never);
    expect(edit.error?.message).toBe("forbidden");

    const status = await fatou.client.from("resources").select("editorial_status").eq("id", resourceId);
    expect(status.data).toEqual([{ editorial_status: "pending" }]);
  });

  it("un titre contenant du HTML est une simple donnée : accepté tel quel, jamais interprété", async () => {
    const title = `<script>alert(1)</script> ${run}`;
    const { data, error } = await fatou.client.rpc("submit_resource" as never, {
      payload: payload({ title }),
    } as never);
    expect(error).toBeNull();
    const row = await fatou.client.from("resources").select("title").eq("id", data as unknown as string);
    expect(row.data).toEqual([{ title }]);
  });

  it("la recherche plein texte par appel direct ne montre que les fiches visibles", async () => {
    const token = `zzdirect${run.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    const { data: pendingId, error } = await fatou.client.rpc("submit_resource" as never, {
      payload: payload({ title: `Proposition ${token}` }),
    } as never);
    expect(error).toBeNull();

    // Opérateurs libres, négation comprise : la RLS s'applique avant le filtre.
    for (const expression of [`${token}:*`, `!${token}:*`, `${token}:* | a:*`]) {
      const anon = await anonymous
        .from("resources")
        .select("id")
        .textSearch("search_vector", expression, { config: "simple" });
      expect(anon.error, expression).not.toBeNull();

      const other = await alice.client
        .from("resources")
        .select("id, editorial_status")
        .textSearch("search_vector", expression, { config: "simple" });
      expect(other.error, expression).toBeNull();
      expect((other.data ?? []).map((row) => row.id)).not.toContain(pendingId);
      expect((other.data ?? []).every((row) => row.editorial_status === "published")).toBe(true);
    }

    // Son auteur, lui, la retrouve.
    const mine = await fatou.client
      .from("resources")
      .select("id")
      .textSearch("search_vector", `${token}:*`, { config: "simple" });
    expect((mine.data ?? []).map((row) => row.id)).toEqual([pendingId]);

    // Mots limites : aucun ne fait échouer la requête.
    for (const words of ["²:*", "123:*", "1e5:*", "شبكات:* & 网络:*", `${"a".repeat(40)}:*`]) {
      const result = await alice.client
        .from("resources")
        .select("id")
        .textSearch("search_vector", words, { config: "simple" })
        .limit(1);
      expect(result.error, words).toBeNull();
    }
  });

  it("la bibliothèque d'un compte est fermée aux autres, par appel direct", async () => {
    const { data: pendingId } = await fatou.client.rpc("submit_resource" as never, {
      payload: payload({ title: `Bibliothèque ${run}` }),
    } as never);

    // Une fiche non publiée ne se garde pas, même par son auteur, au profil complété ; même réponse
    // que pour une fiche inexistante.
    for (const resource_id of [pendingId as unknown as string, randomUUID()]) {
      const favorite = await fatou.client.rpc("set_favorite", { resource_id, favorite: true });
      expect(favorite.error?.message).toBe("not_found");
    }

    const bobProfile = await bob.client.from("profiles").select("age_confirmed_at").maybeSingle();
    const bobOnboarded = Boolean(bobProfile.data?.age_confirmed_at);

    const created = await fatou.client.rpc("create_collection", { name: `Privée ${run}` });
    expect(created.error).toBeNull();
    const collectionId = created.data as string;

    // Écritures directes refusées, y compris pour le titulaire.
    const direct = await Promise.all([
      fatou.client.from("collections").insert({ owner_id: fatou.id, name: "Directe" } as never),
      fatou.client.from("collections").update({ name: "Directe" } as never).eq("id", collectionId),
      fatou.client.from("collections").delete().eq("id", collectionId),
      fatou.client
        .from("collection_items")
        .insert({ collection_id: collectionId, resource_id: pendingId } as never),
      fatou.client
        .from("resource_favorites")
        .insert({ user_id: fatou.id, resource_id: pendingId } as never),
    ]);
    for (const result of direct) expect(result.error).not.toBeNull();

    // Bob et un visiteur ne voient ni ne touchent la collection de Fatou.
    // Bob reçoit la même réponse pour la collection de Fatou et pour une
    // collection qui n'existe pas.
    for (const target of [collectionId, randomUUID()]) {
      const renamed = await bob.client.rpc("update_collection", {
        collection_id: target,
        name: "Piratée",
      });
      const deleted = await bob.client.rpc("delete_collection", { collection_id: target });
      expect([renamed.error?.message, deleted.error?.message]).toEqual(
        bobOnboarded ? ["not_found", "not_found"] : ["forbidden", "forbidden"],
      );
    }

    for (const client of [bob.client, anonymous]) {
      const read = await client.from("collections").select("id").eq("id", collectionId);
      expect(read.data ?? []).toEqual([]);
      for (const call of [
        client.rpc("update_collection", { collection_id: collectionId, name: "Piratée" }),
        client.rpc("delete_collection", { collection_id: collectionId }),
        client.rpc("set_collection_item", {
          collection_id: collectionId,
          resource_id: randomUUID(),
          present: false,
        }),
      ]) {
        expect((await call).error).not.toBeNull();
      }
    }
    const items = await bob.client.from("collection_items").select("collection_id");
    expect(items.data ?? []).toEqual([]);
    const favorites = await bob.client.from("resource_favorites").select("user_id");
    expect((favorites.data ?? []).every((row) => row.user_id === bob.id)).toBe(true);

    // Elle existe toujours, intacte.
    const mine = await fatou.client.from("collections").select("name").eq("id", collectionId);
    expect(mine.data).toEqual([{ name: `Privée ${run}` }]);
    await fatou.client.rpc("delete_collection", { collection_id: collectionId });
  });

  it("un projet de recherche n'est lisible que de son propriétaire, par appel direct", async () => {
    const created = await fatou.client.rpc("create_project", {
      payload: { title: `Projet privé ${run}`, owner_id: bob.id, status: "completed" },
    });
    expect(created.error).toBeNull();
    const projectId = created.data as string;

    const mine = await fatou.client
      .from("research_projects")
      .select("title, status, owner_id")
      .eq("id", projectId);
    expect(mine.data).toEqual([{ title: `Projet privé ${run}`, status: "draft", owner_id: fatou.id }]);

    // Ni un autre compte, ni un visiteur, ni même le rôle serveur ne le lisent.
    for (const client of [bob.client, alice.client, anonymous, admin]) {
      const read = await client.from("research_projects").select("id").eq("id", projectId);
      expect(read.data ?? []).toEqual([]);
    }
    // Écritures directes refusées, y compris pour la propriétaire.
    const direct = await Promise.all([
      fatou.client.from("research_projects").update({ title: "Directe" } as never).eq("id", projectId),
      fatou.client.from("research_projects").delete().eq("id", projectId),
      fatou.client.from("research_projects").insert({ owner_id: fatou.id, title: "Directe" } as never),
      bob.client.from("research_projects").update({ owner_id: bob.id } as never).eq("id", projectId),
    ]);
    for (const result of direct) expect(result.error).not.toBeNull();

    // Un autre compte, par les fonctions : rien, et rien n'indique que le projet existe.
    for (const client of [bob.client, anonymous]) {
      for (const target of [projectId, randomUUID()]) {
        const updated = await client.rpc("update_project", {
          project_id: target,
          payload: { title: "Piraté" },
        });
        const deleted = await client.rpc("delete_project", { project_id: target });
        expect(updated.error).not.toBeNull();
        expect(deleted.error).not.toBeNull();
        expect(updated.error?.message).not.toContain("Projet privé");
        // Une requête invalide ne renseigne pas davantage.
        const invalid = await client.rpc("update_project", {
          project_id: target,
          payload: { due_date: "pas-une-date", status: "published" },
        });
        expect(invalid.error?.message).toBe(updated.error?.message);
        expect(invalid.error?.code).toBe(updated.error?.code);
      }
    }

    const intact = await fatou.client.from("research_projects").select("title").eq("id", projectId);
    expect(intact.data).toEqual([{ title: `Projet privé ${run}` }]);

    // Supprimé : il cesse d'être lisible, même de sa propriétaire.
    expect((await fatou.client.rpc("delete_project", { project_id: projectId })).error).toBeNull();
    const gone = await fatou.client.from("research_projects").select("id").eq("id", projectId);
    expect(gone.data).toEqual([]);
  });

  it("les sources et fiches de lecture d'un projet sont fermées aux autres, par appel direct", async () => {
    const project = await fatou.client.rpc("create_project", { payload: { title: `Sources ${run}` } });
    expect(project.error).toBeNull();
    const projectId = project.data as string;

    const added = await fatou.client.rpc("add_project_source", {
      project_id: projectId,
      payload: { title: `Source privée ${run}`, source_type: "book" },
    });
    expect(added.error).toBeNull();
    const sourceId = added.data as string;
    const noted = await fatou.client.rpc("save_literature_note", {
      source_id: sourceId,
      payload: { problem: "Note privée" },
    });
    expect(noted.error).toBeNull();

    // Lecture : personne d'autre, pas même le rôle serveur.
    for (const client of [bob.client, alice.client, anonymous, admin]) {
      const sources = await client.from("project_sources").select("id").eq("id", sourceId);
      expect(sources.data ?? []).toEqual([]);
      const notes = await client.from("literature_notes").select("source_id").eq("source_id", sourceId);
      expect(notes.data ?? []).toEqual([]);
    }

    // Écritures directes refusées, y compris pour la propriétaire.
    const direct = await Promise.all([
      fatou.client.from("project_sources").insert({ project_id: projectId, title: "Directe" } as never),
      fatou.client.from("project_sources").update({ title: "Directe" } as never).eq("id", sourceId),
      fatou.client.from("project_sources").delete().eq("id", sourceId),
      fatou.client.from("literature_notes").update({ problem: "Directe" } as never).eq("source_id", sourceId),
      bob.client.from("literature_notes").insert({ source_id: sourceId, problem: "Intrus" } as never),
    ]);
    for (const result of direct) expect(result.error).not.toBeNull();

    // Par les fonctions : même réponse pour la source d'autrui et une source
    // inexistante, que la requête soit valide ou non.
    for (const target of [sourceId, randomUUID()]) {
      const responses = await Promise.all([
        bob.client.rpc("update_project_source", { source_id: target, payload: { title: "Piratée" } }),
        bob.client.rpc("update_project_source", {
          source_id: target,
          payload: { title: "", publication_year: "x", accessed_on: "y" },
        }),
        bob.client.rpc("save_literature_note", { source_id: target, payload: { problem: "Intrus" } }),
        bob.client.rpc("delete_project_source", { source_id: target }),
      ]);
      const outcomes = responses.map((response) => [response.error?.code, response.error?.message]);
      expect(new Set(outcomes.map((outcome) => JSON.stringify(outcome))).size, target).toBe(1);
      expect(outcomes[0]?.[1]).not.toContain("Source privée");
    }
    const additions = [];
    for (const target of [projectId, randomUUID()]) {
      for (const response of [
        await bob.client.rpc("add_project_source", {
          project_id: target,
          payload: { title: "Intruse" },
        }),
        await bob.client.rpc("add_project_source_from_resource", {
          project_id: target,
          resource_id: randomUUID(),
        }),
      ]) {
        expect(response.error).not.toBeNull();
        additions.push(JSON.stringify([response.error?.code, response.error?.message]));
      }
    }
    // Projet d'autrui et projet inexistant : strictement la même réponse.
    expect(new Set(additions).size).toBe(1);

    const intact = await fatou.client.from("project_sources").select("title").eq("id", sourceId);
    expect(intact.data).toEqual([{ title: `Source privée ${run}` }]);
    const note = await fatou.client.from("literature_notes").select("problem").eq("source_id", sourceId);
    expect(note.data).toEqual([{ problem: "Note privée" }]);

    // Projet supprimé : sources et fiches cessent aussitôt d'être lisibles.
    await fatou.client.rpc("delete_project", { project_id: projectId });
    const gone = await fatou.client.from("project_sources").select("id").eq("id", sourceId);
    expect(gone.data).toEqual([]);
    const goneNote = await fatou.client.from("literature_notes").select("source_id").eq("source_id", sourceId);
    expect(goneNote.data).toEqual([]);
  });

  it("le plan d'un mémoire et ses citations sont fermés aux autres, par appel direct", async () => {
    const project = await fatou.client.rpc("create_project", { payload: { title: `Plan ${run}` } });
    const projectId = project.data as string;
    const section = await fatou.client.rpc("add_thesis_section", {
      project_id: projectId,
      payload: { title: `Section privée ${run}`, level: "1" },
    });
    expect(section.error).toBeNull();
    const sectionId = section.data as string;
    const written = await fatou.client.rpc("update_thesis_section", {
      section_id: sectionId,
      payload: { body: "Texte privé du mémoire." },
    });
    expect(written.error).toBeNull();
    const source = await fatou.client.rpc("add_project_source", {
      project_id: projectId,
      payload: { title: `Source citée ${run}` },
    });
    const sourceId = source.data as string;
    expect(
      (await fatou.client.rpc("set_section_citation", {
        section_id: sectionId,
        source_id: sourceId,
        present: true,
        pages: "p. 3",
      })).error,
    ).toBeNull();

    // Lecture : personne d'autre, pas même le rôle serveur.
    for (const client of [bob.client, alice.client, anonymous, admin]) {
      const sections = await client.from("thesis_sections").select("id").eq("id", sectionId);
      expect(sections.data ?? []).toEqual([]);
      const citations = await client.from("section_citations").select("section_id").eq("section_id", sectionId);
      expect(citations.data ?? []).toEqual([]);
    }

    // Écritures directes refusées, y compris pour la propriétaire.
    const direct = await Promise.all([
      fatou.client.from("thesis_sections").update({ body: "Directe" } as never).eq("id", sectionId),
      fatou.client.from("thesis_sections").delete().eq("id", sectionId),
      fatou.client
        .from("thesis_sections")
        .insert({ project_id: projectId, position: 99, title: "Directe" } as never),
      bob.client
        .from("section_citations")
        .insert({ section_id: sectionId, source_id: sourceId } as never),
      fatou.client.from("section_citations").delete().eq("section_id", sectionId),
    ]);
    for (const result of direct) expect(result.error).not.toBeNull();

    // Par les fonctions : la section d'autrui et une section inexistante
    // donnent strictement la même réponse, requête valide ou non.
    for (const target of [sectionId, randomUUID()]) {
      const responses = await Promise.all([
        bob.client.rpc("update_thesis_section", { section_id: target, payload: { body: "Piraté" } }),
        bob.client.rpc("update_thesis_section", {
          section_id: target,
          payload: { level: "9", expected_updated_at: "x" },
        }),
        bob.client.rpc("move_thesis_section", { section_id: target, direction: "up" }),
        bob.client.rpc("move_thesis_section", { section_id: target, direction: "ailleurs" }),
        bob.client.rpc("delete_thesis_section", { section_id: target }),
        bob.client.rpc("set_section_citation", { section_id: target, source_id: sourceId, present: true }),
        bob.client.rpc("set_section_citation", { section_id: target, source_id: sourceId, present: false }),
      ]);
      const outcomes = new Set(
        responses.map((response) => JSON.stringify([response.error?.code, response.error?.message])),
      );
      expect(outcomes.size, target).toBe(1);
      expect([...outcomes][0]).not.toContain("Section privée");
    }

    const intact = await fatou.client.from("thesis_sections").select("title, body").eq("id", sectionId);
    expect(intact.data).toEqual([{ title: `Section privée ${run}`, body: "Texte privé du mémoire." }]);
    const citations = await fatou.client.from("section_citations").select("pages").eq("section_id", sectionId);
    expect(citations.data).toEqual([{ pages: "p. 3" }]);

    await fatou.client.rpc("delete_project", { project_id: projectId });
    const gone = await fatou.client.from("thesis_sections").select("id").eq("id", sectionId);
    expect(gone.data).toEqual([]);
  });

  it("l'import par connecteur n'est appelable que par le serveur", async () => {
    const work = {
      source_name: "crossref",
      source_identifier: `10.5555/integration.${run}`,
      type_code: "article",
      title: "Import tenté par appel direct",
      authors: ["Auteur Test"],
      language_code: "fr",
      program_code: "computer_science",
      doi: `10.5555/integration.${run}`,
      official_url: `https://doi.org/10.5555/integration.${run}`,
    };
    for (const client of [anonymous, alice.client, fatou.client]) {
      const { error } = await client.rpc("import_connector_resource", {
        actor_id: fatou.id,
        payload: work,
      });
      expect(error).not.toBeNull();
    }
    // Même le serveur n'importe pas au nom d'un compte sans rôle de modération.
    const asServer = await admin.rpc("import_connector_resource", {
      actor_id: alice.id,
      payload: work,
    });
    expect(asServer.error?.message).toBe("forbidden");

    const rows = await admin.from("resources").select("id").eq("source_identifier", work.source_identifier);
    expect(rows.data).toEqual([]);
  });

  it("la base refuse une adresse dangereuse et une licence inconnue", async () => {
    for (const overrides of [
      { official_url: "javascript:alert(1)" },
      { official_url: "data:text/html,<script>alert(1)</script>" },
      { official_url: "https://vrai.example@hostile.example/" },
      { license_code: "gratuit" },
      { title: "Titre \u202Edéguisé" },
    ]) {
      const { error } = await fatou.client.rpc("submit_resource" as never, {
        payload: payload(overrides),
      } as never);
      // Refus par une contrainte de la base, pas par une erreur quelconque.
      expect(error?.code, JSON.stringify(overrides)).toBe("23514");
    }
  });
});

// Second facteur : ce que le service d'authentification refuse lui-même, et le
// hook qui borne les essais (constats de la revue de sécurité, reproduits sur
// l'instance locale avant correction : 40 codes faux acceptés d'affilée).
describe("second facteur, service d'authentification en appel direct", () => {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function totp(secret: string): string {
    let bits = "";
    for (const char of secret.replace(/=+$/, "").toUpperCase()) {
      bits += ALPHABET.indexOf(char).toString(2).padStart(5, "0");
    }
    const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac("sha1", key).update(counter).digest();
    const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  }

  async function withSecondFactor(label: string) {
    const actor = await createActor(label);
    const enrollment = await actor.client.auth.mfa.enroll({ factorType: "totp" });
    if (enrollment.error || enrollment.data.type !== "totp") throw new Error("activation impossible");
    const secret = enrollment.data.totp.secret;
    const factorId = enrollment.data.id;
    const code = totp(secret);
    const verified = await actor.client.auth.mfa.challengeAndVerify({ factorId, code });
    if (verified.error) throw new Error("vérification impossible");

    const passwordOnly = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const session = await passwordOnly.auth.signInWithPassword({ email: actor.email, password });
    if (session.error) throw new Error("connexion impossible");
    return { actor, factorId, secret, code, passwordOnly };
  }

  it("un code déjà utilisé est refusé", async () => {
    const { actor, factorId, code, passwordOnly } = await withSecondFactor("rejeu");
    try {
      const replay = await passwordOnly.auth.mfa.challengeAndVerify({ factorId, code });
      expect(replay.error).not.toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(actor.id);
    }
  });

  it("après dix codes faux, le facteur est bloqué, même pour un code juste", async () => {
    const { actor, factorId, secret, passwordOnly } = await withSecondFactor("essais");
    try {
      let processed = 0;
      let refusal: string | undefined;
      for (let attempt = 0; attempt < 14; attempt += 1) {
        const result = await passwordOnly.auth.mfa.challengeAndVerify({
          factorId,
          code: String(100000 + attempt),
        });
        if (result.error?.code === "mfa_verification_failed") {
          processed += 1;
        } else {
          refusal = result.error?.code;
          break;
        }
      }
      expect(processed).toBe(10);
      expect(refusal).toBe("mfa_verification_rejected");

      // Le refus ferme toutes les sessions du compte, y compris celle qui avait
      // présenté le second facteur : elle ne se renouvelle plus. Son jeton
      // d'accès déjà émis reste valable jusqu'à son expiration (dix minutes).
      const renewed = await actor.client.auth.refreshSession();
      expect(renewed.error).not.toBeNull();

      // Une nouvelle session reste bloquée pendant la fenêtre, même avec le bon code.
      const again = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await again.auth.signInWithPassword({ email: actor.email, password });
      const blocked = await again.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
      expect(blocked.error?.code).toBe("mfa_verification_rejected");
    } finally {
      await admin.auth.admin.deleteUser(actor.id);
    }
  });

  it("une session ouverte par le seul mot de passe ne modifie ni les facteurs, ni le mot de passe, ni l'adresse", async () => {
    const { actor, factorId, passwordOnly } = await withSecondFactor("aal1");
    try {
      const results = await Promise.all([
        passwordOnly.auth.mfa.enroll({ factorType: "totp", friendlyName: "second" }),
        passwordOnly.auth.mfa.unenroll({ factorId }),
        passwordOnly.auth.updateUser({ password: `Autre-${randomUUID()}` }),
        passwordOnly.auth.updateUser({ email: `autre-${run}@test.invalid` }),
      ]);
      for (const result of results) {
        expect(result.error?.code).toBe("insufficient_aal");
      }
    } finally {
      await admin.auth.admin.deleteUser(actor.id);
    }
  });

  it("le facteur d'un autre compte ne se vérifie pas", async () => {
    const { actor, factorId, secret } = await withSecondFactor("autrui");
    try {
      const result = await alice.client.auth.mfa.challengeAndVerify({
        factorId,
        code: totp(secret),
      });
      expect(result.error).not.toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(actor.id);
    }
  });
});
