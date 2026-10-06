#!/usr/bin/env node
// Contrôle de secrets (audit initial S-01, modèle de menaces M-41 et M-13).
// Sans argument : fichiers suivis par Git, lus sur le disque.
// Avec --staged : contenu indexé, tel qu'il partira dans le commit.
// Ce contrôle local est un filet ; la CI exécute en plus un scanner dédié.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isForbiddenName, isTestFile, scanContent } from "./lib/secret-rules.mjs";

const staged = process.argv.includes("--staged");
const maxSize = 1_000_000;

const git = (args, options = {}) =>
  execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024, ...options });

const files = git(
  staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const binary = /\.(png|jpg|jpeg|gif|ico|webp|avif|woff2?|pdf|zip)$/i;
// Fichiers qui décrivent les motifs eux-mêmes.
const selfDescribing = new Set([
  "scripts/lib/secret-rules.mjs",
  "scripts/check-secrets.test.mjs",
  "scripts/check-client-bundle.mjs",
  "scripts/check-client-bundle.test.mjs",
]);

const findings = [];

for (const file of files) {
  if (isForbiddenName(file)) {
    findings.push(`${file} : fichier interdit dans le dépôt`);
    continue;
  }
  if (binary.test(file) || file === "package-lock.json") continue;
  if (selfDescribing.has(file)) continue;

  let buffer;
  try {
    // En mode --staged, on lit le contenu indexé et non le fichier sur disque.
    buffer = staged ? git(["show", `:${file}`]) : readFileSync(file);
  } catch {
    findings.push(`${file} : lecture impossible, fichier non analysé`);
    continue;
  }

  if (buffer.length > maxSize) {
    findings.push(`${file} : fichier de plus de 1 Mo, non analysé`);
    continue;
  }

  const options = { allowFixtureMarker: isTestFile(file) };
  for (const { line, label } of scanContent(buffer.toString("utf8"), options)) {
    findings.push(`${file}:${line} : ${label}`);
  }
}

if (findings.length > 0) {
  console.error("Contrôle de secrets en échec :\n");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "\nRetirez la valeur, faites-la tourner si elle a été exposée, puis recommencez.",
  );
  process.exit(1);
}

console.log(`Aucun secret détecté (${files.length} fichiers).`);
