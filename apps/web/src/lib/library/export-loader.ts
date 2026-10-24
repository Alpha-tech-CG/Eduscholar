import "server-only";
import { getPublishedResources } from "@/lib/catalogue/queries";
import { createSessionClient } from "@/lib/supabase/server";
import type { LibraryEntry } from "./citation-export";

// Lecture de la bibliothèque à exporter, sous la session de l'utilisateur :
// la RLS ne rend que ses favoris, ses collections et leurs notes. Seules les
// fiches encore publiées et publiques sont exportées ; une fiche retirée n'a
// plus de métadonnées lisibles.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE = 500;
/** Plafonds des favoris (2 000) et d'une collection (500), tenus par la base. */
const MAX_ROWS = 2000;

type Loaded =
  | { status: "ok"; entries: LibraryEntry[]; name: string }
  | { status: "not_found" }
  | { status: "failed" };

type Saved = { resource_id: string; note: string | null };

async function toEntries(rows: Saved[], tags: Map<string, string[]>): Promise<LibraryEntry[] | null> {
  const entries: LibraryEntry[] = [];
  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const resources = await getPublishedResources(chunk.map((row) => row.resource_id));
    if (resources === null) return null;
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    for (const row of chunk) {
      const resource = byId.get(row.resource_id);
      if (!resource) continue;
      entries.push({
        id: resource.id,
        typeCode: resource.typeCode,
        title: resource.title,
        authors: resource.authors,
        publicationYear: resource.publicationYear,
        institutionName: resource.institutionName,
        thesisDegree: resource.thesisDegree,
        languageCode: resource.languageCode,
        doi: resource.doi,
        officialUrl: resource.officialUrl,
        note: row.note,
        tags: tags.get(resource.id) ?? [],
      });
    }
  }
  return entries;
}

export async function loadLibraryEntries(collectionId: string | null): Promise<Loaded> {
  const supabase = await createSessionClient();

  if (collectionId !== null) {
    if (!UUID.test(collectionId)) return { status: "not_found" };
    const { data: collection, error } = await supabase
      .from("collections")
      .select("id, name")
      .eq("id", collectionId)
      .maybeSingle();
    if (error) return { status: "failed" };
    // La collection d'un autre et une collection inexistante répondent pareil.
    if (!collection) return { status: "not_found" };

    const { data: items, error: itemsError } = await supabase
      .from("collection_items")
      .select("resource_id, note")
      .eq("collection_id", collection.id)
      .order("added_at", { ascending: false })
      .order("resource_id")
      .limit(PAGE);
    if (itemsError) return { status: "failed" };
    const entries = await toEntries(items ?? [], new Map());
    return entries ? { status: "ok", entries, name: collection.name } : { status: "failed" };
  }

  const rows: Saved[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("resource_favorites")
      .select("resource_id, note")
      .order("created_at", { ascending: false })
      .order("resource_id")
      .range(from, from + PAGE - 1);
    if (error) return { status: "failed" };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }

  const tags = new Map<string, string[]>();
  for (let start = 0; start < rows.length; start += 100) {
    const ids = rows.slice(start, start + 100).map((row) => row.resource_id);
    const { data, error } = await supabase
      .from("favorite_tags")
      .select("resource_id, tag")
      .in("resource_id", ids)
      .order("tag")
      .limit(ids.length * 10);
    if (error) return { status: "failed" };
    for (const row of data ?? []) tags.set(row.resource_id, [...(tags.get(row.resource_id) ?? []), row.tag]);
  }

  const entries = await toEntries(rows, tags);
  return entries ? { status: "ok", entries, name: "favoris" } : { status: "failed" };
}
