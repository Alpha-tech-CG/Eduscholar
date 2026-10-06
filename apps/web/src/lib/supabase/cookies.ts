import type { CookieOptions } from "@supabase/ssr";

/**
 * Nom du cookie de session.
 *
 * En production, le préfixe `__Host-` fait refuser par le navigateur tout
 * cookie de ce nom qui ne serait pas `Secure`, limité à cet hôte exact et à la
 * racine : un sous-domaine voisin ne peut donc pas déposer une session à la
 * place de l'utilisateur.
 */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-es-session" : "es-session";

/** Le cookie de session peut être découpé en plusieurs morceaux suffixés. */
export function isSessionCookie(name: string): boolean {
  return name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`);
}

/**
 * Options imposées aux cookies de session (ADR-0007, modèle de menaces M-03).
 *
 * Le navigateur n'a aucun client Supabase : rien ne justifie qu'un script lise
 * la session. `HttpOnly` est donc forcé, quelles que soient les options
 * proposées par la bibliothèque.
 */
export function sessionCookieOptions(options: CookieOptions = {}): CookieOptions {
  const { domain: _domain, ...rest } = options;
  void _domain;

  return {
    ...rest,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
