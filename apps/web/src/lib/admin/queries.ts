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
  /** Page affichée, à partir de 1. */
  page: number;
  /** Il existe une page suivante. */
  hasNext: boolean;
};

/** Nombre de comptes par page. La base n'en rend pas plus de cinq cents en tout. */
export const ACCOUNT_PAGE_SIZE = 50;
const LAST_PAGE = 10;

/** Numéro de page lu dans l'adresse : un entier de 1 à 10, sinon 1. */
export function accountPage(value: unknown): number {
  const page = typeof value === "string" && /^\d{1,2}$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(page, 1), LAST_PAGE);
}

/** Comptes détenant un rôle et comptes suspendus, page par page. `null` si la lecture échoue. */
export async function listAdminAccounts(page = 1): Promise<AdminAccountList | null> {
  const supabase = await createSessionClient();
  const from = (page - 1) * ACCOUNT_PAGE_SIZE;
  // Un compte de plus que la page : il dit s'il y en a une suivante.
  const { data, error } = await supabase.rpc("admin_list_accounts").range(from, from + ACCOUNT_PAGE_SIZE);
  if (error) return null;

  const accounts = (data ?? []).slice(0, ACCOUNT_PAGE_SIZE).map((row) => ({
    userId: row.user_id,
    email: row.email,
    roles: row.roles,
    suspended: row.suspended,
    suspensionReason: row.suspension_reason,
  }));
  return { accounts, page, hasNext: (data ?? []).length > ACCOUNT_PAGE_SIZE && page < LAST_PAGE };
}

export type AuthEventCount = {
  /** Jour, en temps universel (AAAA-MM-JJ). */
  day: string;
  /** « failed », « limited » ou « new-device ». */
  nature: string;
  /** Opération concernée (« sign-in », « password-reset »…). */
  operation: string;
  total: number;
};

/**
 * Échecs et limites atteintes de l'authentification sur sept jours : des
 * nombres, sans adresse ni compte. `null` si la lecture échoue.
 */
export async function listAuthEvents(): Promise<AuthEventCount[] | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("admin_auth_events");
  if (error) return null;
  return (data ?? []).map((row) => {
    const [nature = "", operation = ""] = row.kind.split(":");
    return { day: row.day, nature, operation, total: row.total };
  });
}
