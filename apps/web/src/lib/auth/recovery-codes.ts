import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

// État des codes de secours de l'utilisateur courant.

export type RecoveryCodesState = {
  /** Codes encore utilisables. */
  remaining: number;
  /** Date de génération des codes en cours, s'il y en a. */
  generatedAt: string | null;
  /** Le second facteur a été présenté dans les dix dernières minutes. */
  recentSecondFactor: boolean;
};

export async function getRecoveryCodesState(): Promise<RecoveryCodesState> {
  const supabase = await createSessionClient();
  const [status, session] = await Promise.all([
    supabase.rpc("recovery_codes_status"),
    supabase.rpc("admin_session"),
  ]);
  return {
    remaining: status.data?.[0]?.remaining ?? 0,
    generatedAt: status.data?.[0]?.generated_at ?? null,
    recentSecondFactor: session.data?.[0]?.recent ?? false,
  };
}

/**
 * Date du dernier usage d'un code de secours sur ce compte, dans les trente
 * derniers jours. Le titulaire en est averti à l'écran : le service
 * d'authentification n'envoie pas de courriel sur ce chemin.
 */
export async function getLastRecoveryCodeUse(): Promise<string | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("last_recovery_code_use");
  return error ? null : (data ?? null);
}
