import "server-only";
import { cache } from "react";
import { createSessionClient } from "@/lib/supabase/server";
import { hasSessionCookie } from "./session-cookie";

export type SecondFactorState = {
  /** Le compte a un second facteur vérifié. */
  enabled: boolean;
  /** La session en cours l'a vérifié. */
  sessionVerified: boolean;
};

/**
 * État du second facteur pour la session courante, lu en base.
 *
 * La base refuse tout accès à un compte qui a un second facteur tant que la
 * session ne l'a pas vérifié (`private.is_account_active`). Cette fonction ne
 * sert qu'à diriger l'utilisateur vers la saisie du code : ce n'est pas elle
 * qui protège les données.
 */
export const getSecondFactorState = cache(async (): Promise<SecondFactorState> => {
  if (!(await hasSessionCookie())) return { enabled: false, sessionVerified: false };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("second_factor_status");
  const row = Array.isArray(data) ? data[0] : null;
  // En cas de panne, on suppose un code attendu : le garde de l'application ne
  // doit pas s'ouvrir quand la base ne répond pas.
  if (error || !row) return { enabled: true, sessionVerified: false };

  return {
    enabled: row.has_verified_factor === true,
    sessionVerified: row.session_verified === true,
  };
});

export function needsSecondFactor(state: SecondFactorState): boolean {
  return state.enabled && !state.sessionVerified;
}

/**
 * Secondes à attendre avant qu'un nouveau code du compte puisse être accepté.
 *
 * Un code n'est accepté qu'une fois, et le suivant seulement une minute à une
 * minute et demie plus tard. La base refuse un code présenté trop tôt en
 * fermant toutes les sessions du compte : l'application lit donc l'attente
 * avant d'envoyer le code, et l'annonce. Ce n'est pas elle qui protège — si la
 * lecture échoue, le code part, et la base tranche.
 */
export async function codeWaitSeconds(): Promise<number> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("second_factor_wait_seconds");
  return error || typeof data !== "number" ? 0 : data;
}
