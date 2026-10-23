#!/usr/bin/env node
// Budget de performance des pages (cahier §14.3, ADR-0012). À lancer après
// `npm run build`, comme check-client-bundle.mjs.
//
// Mesure, pour chaque page, le JavaScript client et les feuilles de style
// chargés au premier affichage, bruts et compressés (gzip, brotli), et les
// compare aux seuils de apps/web/performance-budget.json. Sort en erreur au-delà
// d'un seuil, en nommant la page et l'écart.
//
// Ne mesure pas : le temps réel sur un appareil lent ou un réseau lent, le HTML
// et les données de page, les images, ni le JavaScript chargé plus tard à la
// demande. Voir ADR-0012, « Budget de performance ».

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  checkBudget,
  compressedSizes,
  formatTable,
  kib,
  measurePages,
  pageAssets,
  parseClientReferenceManifest,
  routeOf,
} from "./lib/budget-rules.mjs";

const buildDir = "apps/web/.next";
const budgetFile = "apps/web/performance-budget.json";

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

let buildManifest;
let appPathRoutes;
let manifestFiles;
try {
  buildManifest = readJson(join(buildDir, "build-manifest.json"));
  appPathRoutes = readJson(join(buildDir, "app-path-routes-manifest.json"));
  manifestFiles = walk(join(buildDir, "server", "app")).filter((file) =>
    file.endsWith("page_client-reference-manifest.js"),
  );
} catch {
  console.error(`${buildDir} introuvable ou incomplet : lancez d'abord « npm run build ».`);
  process.exit(1);
}

let budget;
try {
  budget = readJson(budgetFile);
} catch (error) {
  console.error(`${budgetFile} illisible : ${error.message}`);
  process.exit(1);
}

const pages = manifestFiles.map((file) => {
  const { key, manifest } = parseClientReferenceManifest(readFileSync(file, "utf8"));
  return { route: routeOf(key, appPathRoutes), ...pageAssets(buildManifest.rootMainFiles ?? [], manifest) };
});

if (pages.length === 0) {
  console.error("Aucune page trouvée dans le build : lancez d'abord « npm run build ».");
  process.exit(1);
}

const cache = new Map();
function sizeOf(file) {
  if (!cache.has(file)) cache.set(file, compressedSizes(readFileSync(join(buildDir, file))));
  return cache.get(file);
}

let measures;
try {
  measures = measurePages(pages, sizeOf);
} catch (error) {
  console.error(`Fichier du build manquant (${error.message}) : relancez « npm run build ».`);
  process.exit(1);
}

console.log(`Poids au premier affichage, ${measures.length} pages, du plus lourd au plus léger :\n`);
console.log(formatTable(measures));
console.log(
  "\n« dont propre » : JavaScript que toutes les pages ne partagent pas. Polyfills noModule exclus.",
);

const { violations, unknownPages } = checkBudget(measures, budget);

if (unknownPages.length > 0) {
  console.error(`\nSeuils pour des pages qui n'existent plus dans le build (${budgetFile}) :`);
  for (const route of unknownPages) console.error(`  ${route}`);
}

if (violations.length > 0) {
  console.error("\nBudget de performance dépassé :\n");
  for (const v of violations) {
    console.error(
      `  ${v.route} — ${v.label} : ${kib(v.actual)} pour ${kib(v.limit)} autorisés (+${kib(v.excess)}, +${((v.excess / v.limit) * 100).toFixed(1)} %)`,
    );
  }
  console.error(
    `\nAllégez la page, ou, si la hausse est voulue, relevez le seuil dans ${budgetFile} en le justifiant.`,
  );
}

if (violations.length > 0 || unknownPages.length > 0) process.exit(1);

console.log(`\nBudget respecté (${measures.length} pages, seuils de ${budgetFile}).`);
