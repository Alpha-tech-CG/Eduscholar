import "server-only";
import { headers } from "next/headers";
import { getPublishedResources, type Resource } from "@/lib/catalogue/queries";
import { createSessionClient } from "@/lib/supabase/server";
import { LIBRARY_PAGE_SIZE } from "./queries";
import { shouldRecordView } from "./view-policy";

// Historique de consultation personnel. Visible de son seul titulaire (RLS),
// effaçable par lui, purgé au bout de douze mois, désactivable. La base décide
// de ce qui s'enregistre : compte au profil complété, fiche publiée et
// publique, historique activé.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Enregistre la consultation d'une fiche par le compte connecté. À n'appeler
 * que pour une session ouverte. Ne lève jamais : l'historique est un
 * complément, son échec ne change rien à l'affichage de la fiche.
 */
export async function recordResourceView(resourceId: string): Promise<void> {
  if (!UUID.test(resourceId)) return;
  try {
    // Ni préchargement, ni navigation venue d'un autre site (view-policy.ts).
    if (!shouldRecordView(await headers())) return;
    const supabase = await createSessionClient();
    await supabase.rpc("record_resource_view", { resource_id: resourceId });
  } catch {
    // Rien à signaler : ni l'identifiant ni la fiche ne vont au journal.
  }
}

export type HistoryEntry = { resourceId: string; viewedAt: string; resource: Resource | null };

export type HistoryPage = {
  entries: HistoryEntry[];
  total: number;
  page: number;
  lastPage: number;
  failed: boolean;
};

export async function getHistory(page = 1): Promise<HistoryPage> {
  const supabase = await createSessionClient();
  const from = (page - 1) * LIBRARY_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("resource_views")
    .select("resource_id, viewed_at", { count: "exact" })
    .order("viewed_at", { ascending: false })
    .order("resource_id")
    .range(from, from + LIBRARY_PAGE_SIZE - 1);
  if (error && page > 1) return getHistory(1);

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE));
  if (error) return { entries: [], total: 0, page, lastPage, failed: true };

  const rows = data ?? [];
  const resources = await getPublishedResources(rows.map((row) => row.resource_id));
  if (resources === null) return { entries: [], total, page, lastPage, failed: true };
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  return {
    entries: rows.map((row) => ({
      resourceId: row.resource_id,
      viewedAt: row.viewed_at,
      resource: byId.get(row.resource_id) ?? null,
    })),
    total,
    page,
    lastPage,
    failed: false,
  };
}

/** Historique activé : vrai sans réglage enregistré. */
export async function isHistoryEnabled(): Promise<boolean> {
  const supabase = await createSessionClient();
  const { data } = await supabase.from("library_settings").select("history_enabled").maybeSingle();
  return data?.history_enabled ?? true;
}
