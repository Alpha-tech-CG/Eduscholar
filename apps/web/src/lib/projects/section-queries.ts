import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

// Plan du mémoire. Lectures faites sous le jeton de l'utilisateur : la RLS ne
// lui montre que les sections de ses propres projets.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SectionSummary = {
  id: string;
  position: number;
  level: number;
  title: string;
};

export type Section = SectionSummary & {
  projectId: string;
  body: string | null;
  updatedAt: string;
};

export type Citation = { sourceId: string; pages: string | null };

/** Plan d'un projet, dans l'ordre du document. `null` si la lecture a échoué. */
export async function getSections(projectId: string): Promise<SectionSummary[] | null> {
  if (!UUID.test(projectId)) return [];

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("thesis_sections")
    .select("id, position, level, title")
    .eq("project_id", projectId)
    .order("position")
    .limit(100);
  if (error) return null;
  return data ?? [];
}

/**
 * Une section du projet, ou `null`. Elle doit appartenir au projet de
 * l'adresse : inexistante, d'autrui ou d'un autre projet, même réponse.
 */
export async function getSection(projectId: string, sectionId: string): Promise<Section | null> {
  if (!UUID.test(projectId) || !UUID.test(sectionId)) return null;

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("thesis_sections")
    .select("id, project_id, position, level, title, body, updated_at")
    .eq("id", sectionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    projectId: data.project_id,
    position: data.position,
    level: data.level,
    title: data.title,
    body: data.body,
    updatedAt: data.updated_at,
  };
}

/** Sources citées dans une section. */
export async function getCitations(sectionId: string): Promise<Citation[]> {
  if (!UUID.test(sectionId)) return [];
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("section_citations")
    .select("source_id, pages")
    .eq("section_id", sectionId)
    .order("created_at")
    .limit(100);
  return (data ?? []).map((row) => ({ sourceId: row.source_id, pages: row.pages }));
}

/** Nombre de sections d'un projet. */
export async function countSections(projectId: string): Promise<number> {
  if (!UUID.test(projectId)) return 0;
  const supabase = await createSessionClient();
  const { count } = await supabase
    .from("thesis_sections")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  return count ?? 0;
}
