#!/usr/bin/env node
// Audit des dépendances (modèle de menaces M-42).
// Échoue sur tout avis « high » ou « critical », en production comme en
// développement, sauf s'il figure dans security/audit-exceptions.json avec une
// justification et une date d'expiration non dépassée.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { evaluateAudit } from "./lib/audit-rules.mjs";

function runAudit() {
  try {
    return execSync("npm audit --json", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    // npm audit sort en erreur dès qu'un avis existe : le rapport reste sur stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

const report = JSON.parse(runAudit());
if (report.error) {
  console.error(`npm audit a échoué : ${report.error.summary ?? report.error.code}`);
  process.exit(1);
}

const exceptions = JSON.parse(
  readFileSync("security/audit-exceptions.json", "utf8"),
).exceptions;

const { blocking, accepted, expired, unused } = evaluateAudit(
  report,
  exceptions,
  new Date(),
);

for (const { id, packages } of accepted) {
  console.log(`Accepté (exception en cours) : ${id} — ${packages.join(", ")}`);
}
for (const id of unused) {
  console.log(`Exception devenue inutile, à retirer : ${id}`);
}

if (blocking.length > 0 || expired.length > 0) {
  console.error("\nAudit des dépendances en échec :\n");
  for (const { id, severity, packages, title } of blocking) {
    console.error(`  ${severity} ${id} — ${packages.join(", ")} — ${title}`);
  }
  for (const { id, expires } of expired) {
    console.error(`  exception expirée le ${expires} : ${id}`);
  }
  console.error(
    "\nCorrigez la dépendance, ou ajoutez une exception justifiée et datée dans security/audit-exceptions.json, soumise à revue.",
  );
  process.exit(1);
}

console.log("Audit des dépendances : aucun avis élevé ou critique non traité.");
