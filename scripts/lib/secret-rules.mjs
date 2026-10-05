// Règles de détection de secrets, partagées par check-secrets.mjs et ses tests.
// La valeur détectée n'est jamais renvoyée ni affichée.

import { basename } from "node:path";

const forbiddenNames = [
  { pattern: /^\.env(\..+)?$/, except: /^\.env\.example$/ },
  { pattern: /^\.envrc$/ },
  { pattern: /^\.env-.+$/ },
  { pattern: /\.env$/ },
  { pattern: /\.(pem|key|p12|pfx|jks|keystore)$/ },
  { pattern: /^id_(rsa|ed25519|ecdsa)/ },
  { pattern: /^(credentials|service-account).*\.json$/ },
  { pattern: /\.(dump|sql\.gz)$/ },
];

// Variables autorisées à porter le préfixe NEXT_PUBLIC_ (ADR-0007 : le
// navigateur n'appelle pas Supabase, donc la liste est vide). Tout ajout
// passe par une revue.
export const allowedPublicVariables = new Set([]);

const secretWord =
  "(?:secret|service_?role|private_?key|password|passwd|pwd|api_?key|auth_?token|access_?token|signing_?key|encryption_?key)";

const patterns = [
  ["clé privée", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  [
    "jeton JWT",
    /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/,
  ],
  ["clé Supabase", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ["clé AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["jeton npm", /\bnpm_[A-Za-z0-9]{30,}\b/],
  ["jeton npm dans .npmrc", /_authToken\s*=\s*\S{8,}/],
  ["clé Google", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["jeton Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["clé Stripe", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}|\bwhsec_[A-Za-z0-9]{16,}/],
  ["clé d'API générique", /\bsk-[A-Za-z0-9_-]{24,}\b/],
  [
    "URL de base avec mot de passe",
    /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@/,
  ],
];

const assignment = new RegExp(
  `["']?[A-Za-z0-9_]*${secretWord}[A-Za-z0-9_]*["']?\\s*[:=]\\s*["'\`]?([A-Za-z0-9+/_=.!@#%^&*-]{12,})`,
  "i",
);

// Une valeur littérale de 12 caractères ou plus est retenue si elle contient un
// chiffre ou atteint 20 caractères : cela écarte les mots de la prose
// (« Secrets : service_role ») sans laisser passer un mot de passe courant.
function looksLikeSecretValue(value) {
  return /\d/.test(value) || value.length >= 20;
}

const publicVariable = /\bNEXT_PUBLIC_[A-Z0-9_]+/g;

// Lignes où un mot comme « password » est suivi d'un nom de type, d'un appel
// ou d'une référence, et non d'une valeur littérale.
const notALiteral =
  /[:=]\s*["'`]?(?:string|boolean|number|undefined|null|process\.env|import\.meta|z\.|t\(|await |new |function|\$|\(|\{|\[|<)/i;

export function isForbiddenName(file) {
  const name = basename(file);
  return forbiddenNames.some(
    ({ pattern, except }) => pattern.test(name) && !except?.test(name),
  );
}

/** Renvoie la liste des constats `{ line, label }` pour un contenu texte. */
export function scanContent(content) {
  const findings = [];

  content.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;

    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) findings.push({ line, label });
    }

    const assigned = assignment.exec(text);
    if (
      assigned &&
      !notALiteral.test(text) &&
      looksLikeSecretValue(assigned[1])
    ) {
      findings.push({ line, label: "secret affecté en clair" });
    }

    for (const name of text.match(publicVariable) ?? []) {
      if (!allowedPublicVariables.has(name)) {
        findings.push({
          line,
          label: `variable exposée au navigateur non autorisée (${name})`,
        });
      }
    }
  });

  return findings;
}
