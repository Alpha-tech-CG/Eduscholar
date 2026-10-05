import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAudit } from "./lib/audit-rules.mjs";

const advisory = (name, id, severity = "high") => ({
  source: 1,
  name,
  title: `avis sur ${name}`,
  url: `https://github.com/advisories/${id}`,
  severity,
});

const report = {
  vulnerabilities: {
    braces: { via: [advisory("braces", "GHSA-aaaa-bbbb-cccc")] },
    // Dépendants : ils ne portent que le nom du paquet en cause.
    micromatch: { via: ["braces"] },
    "fast-glob": { via: ["micromatch"] },
    lodash: { via: [advisory("lodash", "GHSA-dddd-eeee-ffff", "critical")] },
    minor: { via: [advisory("minor", "GHSA-gggg-hhhh-iiii", "moderate")] },
  },
};

const today = new Date("2026-10-06T12:00:00Z");

test("bloque un avis élevé ou critique sans exception", () => {
  const { blocking } = evaluateAudit(report, [], today);
  assert.deepEqual(blocking.map(({ id }) => id).sort(), [
    "GHSA-aaaa-bbbb-cccc",
    "GHSA-dddd-eeee-ffff",
  ]);
});

test("ignore les avis de gravité inférieure", () => {
  const { blocking } = evaluateAudit(report, [], today);
  assert.ok(!blocking.some(({ id }) => id === "GHSA-gggg-hhhh-iiii"));
});

test("accepte un avis couvert par une exception en cours", () => {
  const exceptions = [
    { id: "GHSA-aaaa-bbbb-cccc", reason: "outillage", expires: "2027-01-06" },
  ];
  const { blocking, accepted } = evaluateAudit(report, exceptions, today);
  assert.deepEqual(accepted.map(({ id }) => id), ["GHSA-aaaa-bbbb-cccc"]);
  assert.deepEqual(blocking.map(({ id }) => id), ["GHSA-dddd-eeee-ffff"]);
});

test("refuse une exception expirée", () => {
  const exceptions = [
    { id: "GHSA-aaaa-bbbb-cccc", reason: "outillage", expires: "2026-10-05" },
  ];
  const { expired, accepted } = evaluateAudit(report, exceptions, today);
  assert.deepEqual(expired, [
    { id: "GHSA-aaaa-bbbb-cccc", expires: "2026-10-05" },
  ]);
  assert.deepEqual(accepted, []);
});

test("signale une exception devenue inutile", () => {
  const exceptions = [
    { id: "GHSA-zzzz-zzzz-zzzz", reason: "ancien", expires: "2027-01-01" },
  ];
  assert.deepEqual(evaluateAudit(report, exceptions, today).unused, [
    "GHSA-zzzz-zzzz-zzzz",
  ]);
});

test("un rapport vide ne bloque rien", () => {
  const result = evaluateAudit({ vulnerabilities: {} }, [], today);
  assert.deepEqual(result.blocking, []);
});
