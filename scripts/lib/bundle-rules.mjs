// Règles de contrôle du JavaScript envoyé au navigateur (modèle de menaces M-13,
// ADR-0007). Partagées par check-client-bundle.mjs et ses tests.

const forbidden = [
  [
    "nom de variable serveur",
    /SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|SUPABASE_SECRET/,
  ],
  ["clé secrète Supabase", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ["clé privée", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["URL de base de données", /\bpostgres(?:ql)?:\/\/[^\s"']+@/],
  // ADR-0007 : le navigateur n'appelle jamais Supabase.
  ["client ou adresse Supabase", /@supabase\/|\.supabase\.co\b/],
];

const jwt = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

function hasServiceRole(payload) {
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * @param {string} content contenu d'un fichier du bundle client
 * @param {Array<[string, string]>} sentinels paires [nom, valeur] de variables
 *   serveur dont la valeur ne doit pas apparaître
 */
export function scanBundle(content, sentinels = []) {
  const findings = [];

  for (const [label, pattern] of forbidden) {
    if (pattern.test(content)) findings.push(label);
  }
  for (const match of content.matchAll(jwt)) {
    if (hasServiceRole(match[1])) {
      findings.push("jeton au rôle service_role");
      break;
    }
  }
  for (const [name, value] of sentinels) {
    if (content.includes(value)) {
      findings.push(`valeur de la variable serveur ${name}`);
    }
  }

  return findings;
}

/** Variables serveur de l'environnement dont la valeur est à rechercher. */
export function serverSentinels(env) {
  return Object.entries(env).filter(
    ([name, value]) =>
      !name.startsWith("NEXT_PUBLIC_") &&
      /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|KEY|DSN|DATABASE_URL)/.test(
        name,
      ) &&
      typeof value === "string" &&
      value.length >= 16,
  );
}
