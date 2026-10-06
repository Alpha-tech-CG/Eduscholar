import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env.server";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "./cookies";
import type { Database } from "./database.types";

export type { User } from "@supabase/supabase-js";

/**
 * Client lié à la session de l'utilisateur courant.
 * Toute requête passe sous son jeton : la RLS s'applique.
 */
export async function createSessionClient(): Promise<SupabaseClient<Database>> {
  const env = serverEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: SESSION_COOKIE_NAME },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, sessionCookieOptions(options));
          }
        } catch {
          // Un composant serveur ne peut pas écrire de cookie : le
          // rafraîchissement de la session est fait par le proxy.
        }
      },
    },
  });
}

/**
 * Client privilégié (service_role). Il contourne la RLS.
 *
 * Usage limité à la liste fermée de `docs/security/authorization-model.md`
 * §7.5. Il ne porte aucune session et ne lit jamais de contenu au nom d'un
 * utilisateur.
 */
export function createServiceClient(): SupabaseClient<Database> {
  const env = serverEnv();

  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
