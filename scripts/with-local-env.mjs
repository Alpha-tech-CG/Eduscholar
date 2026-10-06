#!/usr/bin/env node
// Lance une commande avec les variables de l'instance Supabase locale.
//
// Les valeurs sont lues auprès de la CLI Supabase et passées au processus
// enfant : elles ne sont écrites dans aucun fichier et jamais affichées.
// Usage : node scripts/with-local-env.mjs <commande> [arguments...]

import { execSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage : node scripts/with-local-env.mjs <commande> [arguments...]");
  process.exit(1);
}

let status;
try {
  status = execSync("npx supabase status -o env", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  console.error(
    "Instance Supabase locale introuvable. Démarrez Docker puis lancez « npm run db:start ».",
  );
  process.exit(1);
}

const local = Object.fromEntries(
  status
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

const required = ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"];
const missing = required.filter((name) => !local[name]);
if (missing.length > 0) {
  console.error(`Variables absentes de « supabase status » : ${missing.join(", ")}`);
  process.exit(1);
}

const env = {
  ...process.env,
  SUPABASE_URL: local.API_URL,
  SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: local.SECRET_KEY,
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  // Boîte de réception locale, utilisée par les tests de bout en bout.
  MAILPIT_URL: local.MAILPIT_URL ?? local.INBUCKET_URL ?? "",
};

// La commande vient du fichier package.json, jamais d'une saisie externe.
const child = spawn([command, ...args].join(" "), { env, stdio: "inherit", shell: true });
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
