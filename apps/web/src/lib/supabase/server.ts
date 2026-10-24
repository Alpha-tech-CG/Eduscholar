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

/**
 * Client du visiteur (rôle `anon`), sans session ni cookie (ADR-0014).
 *
 * Il ne sert qu'aux lectures du catalogue public : la base ne lui ouvre que
 * les fonctions `public_*`, en lecture seule, sur les fiches publiées et
 * publiques. Aucune table ne lui est lisible.
 */
export function createAnonymousClient(): SupabaseClient<Database> {
  const env = serverEnv();

  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Vérifie un mot de passe sans toucher à la session en cours : le client
 * utilisé ne lit ni n'écrit aucun cookie.
 */
export async function verifyPassword(
  email: string,
  password: string,
  /** Jeton du défi anti-robot, exigé par le service quand le défi est activé. */
  captchaToken?: string,
): Promise<boolean> {
  const env = serverEnv();
  const client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  if (error?.code === "captcha_failed") {
    // Le formulaire dira « mot de passe incorrect » ; l'exploitation, elle,
    // voit que c'est le défi qui a été refusé.
    console.error("Revérification du mot de passe : défi anti-robot refusé par le service d'authentification.");
    return false;
  }
  if (error || !data.session) return false;

  // La session ouverte pour la vérification est refermée aussitôt.
  await client.auth.signOut({ scope: "local" });
  return true;
}
