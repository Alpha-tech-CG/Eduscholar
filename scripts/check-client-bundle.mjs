#!/usr/bin/env node
// Vérifie qu'aucun secret serveur n'a été embarqué dans le JavaScript envoyé
// au navigateur (modèle de menaces M-13). À lancer après `npm run build`.
//
// La CI construit avec des valeurs sentinelles : si l'une d'elles se retrouve
// dans le bundle, c'est qu'un module serveur a fui vers le client.
// Limite connue : seuls les fichiers statiques sont lus. Une valeur passée en
// propriété d'un composant serveur à un composant client part dans le HTML ;
// ce cas sera couvert par un test de bout en bout avec le premier module
// serveur (B-09).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scanBundle, serverSentinels } from "./lib/bundle-rules.mjs";

const root = "apps/web/.next/static";

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let files;
try {
  files = walk(root).filter((file) => /\.(js|css|json|map|html)$/.test(file));
} catch {
  console.error(`${root} introuvable : lancez d'abord « npm run build ».`);
  process.exit(1);
}

const sentinels = serverSentinels(process.env);
const findings = [];

for (const file of files) {
  for (const label of scanBundle(readFileSync(file, "utf8"), sentinels)) {
    findings.push(`${file} : ${label}`);
  }
}

if (findings.length > 0) {
  console.error("Secret serveur détecté dans le bundle client :\n");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(
  `Bundle client sain (${files.length} fichiers, ${sentinels.length} valeurs sentinelles recherchées).`,
);
