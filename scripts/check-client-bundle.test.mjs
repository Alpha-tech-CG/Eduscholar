import assert from "node:assert/strict";
import { test } from "node:test";
import { scanBundle, serverSentinels } from "./lib/bundle-rules.mjs";

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (claims) =>
  [encode({ alg: "HS256", typ: "JWT" }), encode(claims), "a".repeat(43)].join(
    ".",
  );

test("refuse un jeton service_role encodé", () => {
  const bundle = `const k="${token({ iss: "supabase", role: "service_role" })}";`;
  assert.ok(scanBundle(bundle).includes("jeton au rôle service_role"));
});

test("accepte un jeton sans rôle privilégié", () => {
  const bundle = `const k="${token({ iss: "exemple", role: "anon" })}";`;
  assert.deepEqual(scanBundle(bundle), []);
});

test("refuse toute trace de Supabase côté client", () => {
  assert.ok(scanBundle('fetch("https://abc.supabase' + '.co/rest/v1")').length > 0);
  assert.ok(scanBundle('require("@supabase' + '/supabase-js")').length > 0);
});

test("refuse une valeur sentinelle de variable serveur", () => {
  const sentinels = [["SUPABASE_SECRET_KEY", "canari-0123456789abcdef"]];
  assert.deepEqual(scanBundle("x=canari-0123456789abcdef", sentinels), [
    "valeur de la variable serveur SUPABASE_SECRET_KEY",
  ]);
  assert.deepEqual(scanBundle("x=autre-chose", sentinels), []);
});

test("accepte un bundle ordinaire", () => {
  assert.deepEqual(
    scanBundle('self.__next_f.push([1,"EduScholar"]);const role="user";'),
    [],
  );
});

test("retient les variables serveur sensibles, jamais les publiques", () => {
  const value = "v".repeat(20);
  const names = serverSentinels({
    SUPABASE_SECRET_KEY: value,
    DATABASE_URL: value,
    JWT_SIGNING_KEY: value,
    SENTRY_DSN: value,
    NEXT_PUBLIC_APP_KEY: value,
    PATH: value,
    SHORT_TOKEN: "court",
  }).map(([name]) => name);

  assert.deepEqual(names.sort(), [
    "DATABASE_URL",
    "JWT_SIGNING_KEY",
    "SENTRY_DSN",
    "SUPABASE_SECRET_KEY",
  ]);
});
