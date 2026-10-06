import "server-only";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import { isSessionCookie } from "@/lib/supabase/cookies";
import { isRecoveryMethodList } from "./recovery";
import { createSessionClient, type User } from "@/lib/supabase/server";

export async function hasSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.getAll().some(({ name }) => isSessionCookie(name));
}

/**
 * Utilisateur courant, vérifié auprès du service d'authentification.
 *
 * `getUser()` interroge le serveur d'authentification : contrairement à la
 * simple lecture du cookie, le résultat ne peut pas être falsifié par le
 * client (modèle de menaces M-49). Une seule vérification par requête.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  if (!(await hasSessionCookie())) return null;

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return data.user;
});

/**
 * À appeler en tête de toute page ou action protégée. Redirige vers la
 * connexion si personne n'est connecté. Le proxy ne protège rien (M-53).
 */
export async function requireUser(nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (user) return user;

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/sign-in", query: { next: nextPath } },
    locale,
  });
}

/**
 * Vrai si la session courante vient d'être ouverte par un lien reçu par
 * courriel. L'information est lue dans le jeton signé par le service
 * d'authentification : elle ne peut pas être fabriquée par le client.
 *
 * C'est la seule session autorisée à choisir un mot de passe sans fournir
 * l'ancien : une session ordinaire laissée ouverte sur un poste partagé ne
 * suffit pas à s'emparer du compte.
 */
export async function isRecentRecoverySession(now: number = Date.now()): Promise<boolean> {
  if (!(await hasSessionCookie())) return false;

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return false;

  return isRecoveryMethodList((data.claims as { amr?: unknown }).amr, now);
}
