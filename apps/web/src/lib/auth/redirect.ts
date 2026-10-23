import { LOCALE_PREFIX } from "@/i18n/routing";

/**
 * Destination après connexion (modèle de menaces M-04).
 *
 * N'accepte qu'un chemin interne. Toute valeur qui pourrait mener hors du site
 * — adresse absolue, `//hôte`, barre oblique inverse, caractère de contrôle —
 * est remplacée par la destination par défaut.
 */
export const DEFAULT_AFTER_SIGN_IN = "/account";

const AUTH_PAGES = /^\/(sign-in|sign-up|forgot-password|reset-password|auth)(\/|$)/;


/**
 * Destination après la saisie du second facteur. Identique à `safeNextPath`,
 * avec une exception : le choix d'un nouveau mot de passe, qu'un compte à deux
 * étapes n'atteint qu'après avoir saisi son code.
 */
export function nextAfterVerification(value: unknown): string {
  return value === "/reset-password" ? "/reset-password" : safeNextPath(value);
}

export function safeNextPath(
  value: unknown,
  fallback: string = DEFAULT_AFTER_SIGN_IN,
): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(value, "http://interne.invalid");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "http://interne.invalid") return fallback;

  // Le préfixe de langue est retiré : la redirection le rajoute. Le retrait est
  // répété, puis le résultat est revalidé, pour qu'un chemin comme
  // `/fr//hôte` ne devienne pas `//hôte`.
  let path = parsed.pathname;
  while (LOCALE_PREFIX.test(path)) {
    path = path.replace(LOCALE_PREFIX, "");
  }
  path = path.replace(/\/{2,}/g, "/") || "/";

  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  // Les pages d'authentification ne sont pas une destination : on y bouclerait.
  if (AUTH_PAGES.test(path)) return fallback;

  return `${path}${parsed.search}`;
}
