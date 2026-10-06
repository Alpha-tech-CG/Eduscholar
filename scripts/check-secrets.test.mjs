import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIXTURE_MARKER,
  isForbiddenName,
  isTestFile,
  scanContent,
} from "./lib/secret-rules.mjs";

// Les valeurs sont assemblées à l'exécution : aucun faux secret n'est écrit
// tel quel dans le dépôt.
const filler = (length, char = "a") => char.repeat(length);
const labels = (content) => scanContent(content).map(({ label }) => label);

test("détecte les affectations de secrets, quelle que soit la casse", () => {
  const cases = [
    `SUPABASE_SERVICE_ROLE_KEY=${filler(36)}`,
    `const serviceRoleKey = "${filler(24)}"`,
    `const password = "${"MotDePasse" + "Prod2026"}"`,
    `"SUPABASE_SECRET_KEY": "${filler(20)}"`,
    `api_key: ${"a1".repeat(8)}`,
  ];
  for (const line of cases) {
    assert.ok(
      labels(line).includes("secret affecté en clair"),
      `non détecté : ${line.split(/[:=]/)[0]}`,
    );
  }
});

test("détecte les formats de jetons connus", () => {
  const jwt = ["eyJ" + filler(20), "eyJ" + filler(20), filler(20)].join(".");
  const cases = [
    ["jeton JWT", jwt],
    ["clé Supabase", "sb_secret_" + filler(24)],
    ["clé privée", "-----BEGIN RSA " + "PRIVATE KEY-----"],
    ["jeton GitHub", "ghp_" + filler(36)],
    ["jeton npm dans .npmrc", "//registry.npmjs.org/:_authToken=" + filler(20)],
    ["clé Stripe", "sk_live_" + filler(24)],
    [
      "URL de base avec mot de passe",
      "postgresql://postgres:" + filler(12) + "@db.example.com:5432/postgres",
    ],
  ];
  for (const [label, content] of cases) {
    assert.ok(labels(content).includes(label), `non détecté : ${label}`);
  }
});

test("refuse toute variable NEXT_PUBLIC_ hors liste blanche", () => {
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_API_TOKEN",
  ]) {
    assert.ok(
      labels(`const value = process.env.${name};`).some((label) =>
        label.includes(name),
      ),
      `non refusé : ${name}`,
    );
  }
});

test("ne signale pas le code ordinaire", () => {
  const cases = [
    "const password: string = form.password;",
    "password: z.string().min(12),",
    "const apiKey = process.env.SUPABASE_SECRET_KEY;",
    'const token = await getToken("session");',
    "Le mot de passe est stocké haché.",
    "| B6 | Secrets : `service_role`, clés des connecteurs |",
    'export SUPABASE_SECRET_KEY="$(openssl rand -hex 24)"',
    "| `SUPABASE_SECRET_KEY` | serveur, secret | B-09 |",
  ];
  for (const line of cases) {
    assert.deepEqual(scanContent(line), [], `faux positif : ${line}`);
  }
});

test("renvoie le numéro de ligne", () => {
  const content = ["ligne saine", `TOKEN_SECRET=${filler(30)}`].join("\n");
  assert.equal(scanContent(content)[0]?.line, 2);
});

test("refuse les noms de fichiers sensibles", () => {
  for (const name of [
    ".env",
    ".env.local",
    "apps/web/.env.production",
    ".envrc",
    "prod.env",
    "certs/server.pem",
    "release.keystore",
    "id_rsa",
    "id_ed25519.pub",
    "service-account-prod.json",
    "backup.dump",
    "backup.sql.gz",
  ]) {
    assert.ok(isForbiddenName(name), `non refusé : ${name}`);
  }
});

test("accepte le gabarit .env.example et les fichiers ordinaires", () => {
  for (const name of [
    ".env.example",
    "apps/web/.env.example",
    "docs/environment.md",
    "apps/web/src/lib/env.ts",
    "package.json",
  ]) {
    assert.ok(!isForbiddenName(name), `refusé à tort : ${name}`);
  }
});

test("ne prend pas une référence du code pour une valeur", () => {
  for (const line of [
    "password: parsed.data.password,",
    "const apiKey = config.keys.primary;",
  ]) {
    assert.deepEqual(scanContent(line), [], `faux positif : ${line}`);
  }
});

test("le marqueur de valeur fictive ne vaut que dans un fichier de test", () => {
  const line = `password: "${"motdepasse" + "2026"}", // ${FIXTURE_MARKER}`;
  assert.equal(scanContent(line).length, 1, "ignoré hors fichier de test");
  assert.deepEqual(scanContent(line, { allowFixtureMarker: true }), []);

  assert.ok(isTestFile("apps/web/tests/auth-schemas.test.ts"));
  assert.ok(isTestFile("apps/web/e2e/auth.spec.ts"));
  assert.ok(!isTestFile("apps/web/src/lib/auth/actions.ts"));
  assert.ok(!isTestFile("supabase/migrations/20261006000100_foundation.sql"));
});

test("le marqueur ne masque jamais un format de jeton reconnu", () => {
  const line = `const k = "${"sb_secret_" + "a".repeat(24)}"; // ${FIXTURE_MARKER}`;
  assert.ok(scanContent(line, { allowFixtureMarker: true }).length > 0);
});
