import "server-only";
import { getPublishedResources, type Resource } from "@/lib/catalogue/queries";
import { createSessionClient } from "@/lib/supabase/server";

// Bibliothèque personnelle : favoris et collections. Lectures faites sous le
// jeton de l'utilisateur ; la RLS ne montre à chacun que ses propres lignes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Nombre d'éléments par page. */
export const LIBRARY_PAGE_SIZE = 50;

export type SavedResources = {
  resources: Resource[];
  /** Éléments gardés dont la fiche n'est plus publiée. */
  unavailableIds: string[];
  total: number;
  page: number;
  lastPage: number;
  /** La lecture du catalogue a échoué : l'état des fiches est inconnu. */
  failed: boolean;
};

/** Numéro de page lu dans l'adresse, ramené à une valeur sûre. */
export function parsePage(value: string | string[] | undefined): number {
  const page = Number.parseInt((Array.isArray(value) ? value[0] : value) ?? "", 10);
  return Number.isInteger(page) && page >= 1 ? Math.min(page, 100) : 1;
}

async function resolve(ids: string[], total: number, page: number): Promise<SavedResources> {
  const resources = await getPublishedResources(ids);
  const lastPage = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE));
  if (resources === null) {
    return { resources: [], unavailableIds: [], total, page, lastPage, failed: true };
  }
  const visible = new Set(resources.map((resource) => resource.id));
  return {
    resources,
    unavailableIds: ids.filter((id) => !visible.has(id)),
    total,
    page,
    lastPage,
    failed: false,
  };
}

function range(page: number): [number, number] {
  const from = (page - 1) * LIBRARY_PAGE_SIZE;
  return [from, from + LIBRARY_PAGE_SIZE - 1];
}

export async function getFavorites(page = 1): Promise<SavedResources> {
  const supabase = await createSessionClient();
  const { data, count, error } = await supabase
    .from("resource_favorites")
    .select("resource_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("resource_id")
    .range(...range(page));
  // Page au-delà de la dernière : retour à la première.
  if (error && page > 1) return getFavorites(1);

  return resolve((data ?? []).map((row) => row.resource_id), count ?? 0, page);
}

export async function isFavorite(resourceId: string): Promise<boolean> {
  if (!UUID.test(resourceId)) return false;
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("resource_favorites")
    .select("resource_id")
    .eq("resource_id", resourceId)
    .limit(1);
  return (data ?? []).length === 1;
}

export type Collection = {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
};

export async function getCollections(): Promise<Collection[]> {
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("collections")
    .select("id, name, description, collection_items(count)")
    .order("name")
    .limit(100);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    itemCount: row.collection_items[0]?.count ?? 0,
  }));
}

export async function getCollection(
  id: string,
  page = 1,
): Promise<{ collection: Omit<Collection, "itemCount">; saved: SavedResources } | null> {
  if (!UUID.test(id)) return null;

  const supabase = await createSessionClient();
  const { data: collection } = await supabase
    .from("collections")
    .select("id, name, description")
    .eq("id", id)
    .maybeSingle();
  if (!collection) return null;

  const { data, count, error } = await supabase
    .from("collection_items")
    .select("resource_id", { count: "exact" })
    .eq("collection_id", id)
    .order("added_at", { ascending: false })
    .order("resource_id")
    .range(...range(page));
  if (error && page > 1) return getCollection(id, 1);

  return {
    collection,
    saved: await resolve((data ?? []).map((row) => row.resource_id), count ?? 0, page),
  };
}

/** Identifiants des collections de l'utilisateur qui contiennent cette fiche. */
export async function getCollectionIdsContaining(resourceId: string): Promise<Set<string>> {
  if (!UUID.test(resourceId)) return new Set();
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("collection_items")
    .select("collection_id")
    .eq("resource_id", resourceId)
    .limit(100);
  return new Set((data ?? []).map((row) => row.collection_id));
}
