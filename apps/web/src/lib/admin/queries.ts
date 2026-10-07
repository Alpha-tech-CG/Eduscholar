import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/server";

// Administration de la plateforme. Tout passe par des fonctions de la base,
// sous la session de l'administrateur : c'est elle qui vérifie le rôle, le
// second facteur et sa fraîcheur.

export type AdminSession = {
  /** 0 : aucun droit d'administration ; 2 : administrateur ; 3 : super-administrateur. */
  rank: number;
  /** Second facteur présenté dans les dix dernières minutes. */
  recent: boolean;
};

export const getAdminSession = cache(async (): Promise<AdminSession> => {
  if (!(await getCurrentUser())) return { rank: 0, recent: false };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("admin_session");
  const row = data?.[0];
  if (error || !row) return { rank: 0, recent: false };
  return { rank: row.role_rank, recent: row.recent };
});

export type AdminAccount = {
  userId: string;
  email: string;
  roles: string[];
  suspended: boolean;
  suspensionReason: string | null;
};

export type AdminAccountList = {
  accounts: AdminAccount[];
  /** La liste dépasse ce qui est affiché : elle ne doit pas passer pour complète. */
  truncated: boolean;
};

/** Nombre de comptes affichés : au-delà, la liste se signale comme incomplète. */
const ACCOUNT_LIST_SIZE = 100;

/** Comptes détenant un rôle et comptes suspendus. `null` si la lecture échoue. */
export async function listAdminAccounts(): Promise<AdminAccountList | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("admin_list_accounts").range(0, ACCOUNT_LIST_SIZE - 1);
  if (error) return null;

  const accounts = (data ?? []).map((row) => ({
    userId: row.user_id,
    email: row.email,
    roles: row.roles,
    suspended: row.suspended,
    suspensionReason: row.suspension_reason,
  }));
  // Une page pleine : il peut y en avoir d'autres. L'écran le dit, et la
  // recherche par adresse reste le moyen d'atteindre n'importe quel compte.
  return { accounts, truncated: accounts.length === ACCOUNT_LIST_SIZE };
}
