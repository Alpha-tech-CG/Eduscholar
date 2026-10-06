import "server-only";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import { createSessionClient, type User } from "@/lib/supabase/server";
import { isRecoveryMethodList } from "./recovery";
import { getSecondFactorState, needsSecondFactor } from "./second-factor";
import { hasSessionCookie } from "./session-cookie";

export { hasSessionCookie };

/**
 * Utilisateur courant, vérifié auprès du service d'authentification.
 *
 * `getUser()` interroge le serveur d'authentification : contrairement à la
 * simple lecture du cookie, le résultat ne peut pas être falsifié par le
 * client (modèle de menaces M-49). Une seule vérification par requête.
 *
 * Attention : un utilisateur renvoyé ici peut encore devoir saisir son second
 * facteur. Les pages protégées utilisent `requireUser`.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  if (!(await hasSessionCookie())) return null;

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return data.user;
});

/**
 * À appeler en tête de toute page protégée. Redirige vers la connexion si
 * personne n'est connecté, et vers la saisie du code si le compte a un second
 * facteur que la session n'a pas vérifié. Le proxy ne protège rien (M-53).
 */
export async function requireUser(nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  const locale = await getLocale();

  if (!user) {
    return redirect({
      href: { pathname: "/sign-in", query: { next: nextPath } },
      locale,
    });
  }
  if (needsSecondFactor(await getSecondFactorState())) {
    return redirect({
      href: { pathname: "/sign-in/verify", query: { next: nextPath } },
      locale,
    });
  }
  return user;
}

/**
 * Pour une action serveur : l'utilisateur, seulement si sa session est
 * complète (second facteur vérifié lorsqu'il est activé).
 */
export async function getFullySignedInUser(): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return needsSecondFactor(await getSecondFactorState()) ? null : user;
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
