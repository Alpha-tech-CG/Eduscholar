import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { isSessionCookie, SESSION_COOKIE_NAME, sessionCookieOptions } from "./cookies";
import type { Database } from "./database.types";

export type PendingCookie = {
  name: string;
  value: string;
  options: ReturnType<typeof sessionCookieOptions>;
};

// Délai maximal accordé au service d'authentification avant le rendu : s'il ne
// répond pas, la page est servie sans session plutôt que de rester bloquée.
const REFRESH_TIMEOUT_MS = 4000;

/**
 * Rafraîchit la session avant le rendu, pour que les composants serveur lisent
 * un jeton valide. Ne décide d'aucun accès (modèle de menaces M-53).
 *
 * Renvoie les cookies à poser sur la réponse. Les cookies de la requête sont
 * mis à jour en place, pour le rendu de cette même requête.
 */
export async function refreshSession(request: NextRequest): Promise<PendingCookie[]> {
  const hasSession = request.cookies.getAll().some(({ name }) => isSessionCookie(name));
  if (!hasSession) return [];

  const pending: PendingCookie[] = [];

  try {
    const env = serverEnv();
    const supabase = createServerClient<Database>(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      {
        cookieOptions: { name: SESSION_COOKIE_NAME },
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: init?.signal ?? AbortSignal.timeout(REFRESH_TIMEOUT_MS),
            }),
        },
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              request.cookies.set(name, value);
              pending.push({ name, value, options: sessionCookieOptions(options) });
            }
          },
        },
      },
    );

    await supabase.auth.getClaims();
  } catch {
    // Configuration absente ou service injoignable : la page se rend sans
    // session, et chaque page protégée redirigera vers la connexion.
  }

  return pending;
}
