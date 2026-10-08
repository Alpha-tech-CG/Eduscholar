/**
 * En-têtes de sécurité (cahier §10.3, §10.4 ; modèle de menaces M-03, M-06, M-17, M-46).
 * La CSP porte un nonce par requête : elle est posée par `src/proxy.ts`.
 * Les en-têtes statiques sont posés par `next.config.ts`.
 */

export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/** Origine du défi Cloudflare Turnstile : son script et son cadre. */
export const CAPTCHA_ORIGIN = "https://challenges.cloudflare.com";

export function buildContentSecurityPolicy(
  nonce: string,
  isDev: boolean,
  /** Le défi anti-robot est configuré : son origine, et elle seule, est admise. */
  captcha = false,
): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // React utilise eval en développement uniquement.
      ...(isDev ? ["'unsafe-eval'"] : []),
      ...(captcha ? [CAPTCHA_ORIGIN] : []),
    ],
    // En développement, Next.js injecte des styles sans nonce.
    "style-src": isDev
      ? ["'self'", "'unsafe-inline'"]
      : ["'self'", `'nonce-${nonce}'`],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(isDev ? ["ws:"] : [])],
    // Aucun cadre, sauf celui du défi anti-robot quand il est configuré.
    "frame-src": captcha ? [CAPTCHA_ORIGIN] : ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  if (!isDev) policy.push("upgrade-insecure-requests");

  return policy.join("; ");
}

export const staticSecurityHeaders: ReadonlyArray<{
  key: string;
  value: string;
}> = [
  {
    key: "Strict-Transport-Security",
    // Sans `preload` : l'inscription aux listes des navigateurs engage tout le
    // domaine pour longtemps et demande une décision écrite.
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

// Repli pour les réponses qui ne passent pas par le proxy : une route d'API ne
// sert jamais de page, elle n'a donc besoin d'aucune source.
export const apiContentSecurityPolicy =
  "default-src 'none'; frame-ancestors 'none'; sandbox";
