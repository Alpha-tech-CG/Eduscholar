import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

// Sources d'un projet et fiches de lecture. Lectures faites sous le jeton de
// l'utilisateur : la RLS ne lui montre que celles de ses propres projets.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const SOURCES_PAGE_SIZE = 50;

const SOURCE_COLUMNS =
  "id, project_id, resource_id, source_type, title, authors, publication_year, container_title, publisher, volume, issue, pages, doi, url, accessed_on, updated_at";
const NOTE_COLUMNS =
  "source_id, problem, concepts, method, population_field, results, limits, useful_quote, quote_pages, project_link, target_chapter";

export type Source = {
  id: string;
  projectId: string;
  resourceId: string | null;
  sourceType: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  containerTitle: string | null;
  publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url: string | null;
  accessedOn: string | null;
};

export type LiteratureNote = {
  problem: string | null;
  concepts: string | null;
  method: string | null;
  populationField: string | null;
  results: string | null;
  limits: string | null;
  usefulQuote: string | null;
  quotePages: string | null;
  projectLink: string | null;
  targetChapter: string | null;
};

type SourceRow = {
  id: string;
  project_id: string;
  resource_id: string | null;
  source_type: string;
  title: string;
  authors: string[];
  publication_year: number | null;
  container_title: string | null;
  publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url: string | null;
  accessed_on: string | null;
};

function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    projectId: row.project_id,
    resourceId: row.resource_id,
    sourceType: row.source_type,
    title: row.title,
    authors: row.authors,
    publicationYear: row.publication_year,
    containerTitle: row.container_title,
    publisher: row.publisher,
    volume: row.volume,
    issue: row.issue,
    pages: row.pages,
    doi: row.doi,
    url: row.url,
    accessedOn: row.accessed_on,
  };
}

type NoteRow = {
  source_id: string;
  problem: string | null;
  concepts: string | null;
  method: string | null;
  population_field: string | null;
  results: string | null;
  limits: string | null;
  useful_quote: string | null;
  quote_pages: string | null;
  project_link: string | null;
  target_chapter: string | null;
};

function toNote(row: NoteRow): LiteratureNote {
  return {
    problem: row.problem,
    concepts: row.concepts,
    method: row.method,
    populationField: row.population_field,
    results: row.results,
    limits: row.limits,
    usefulQuote: row.useful_quote,
    quotePages: row.quote_pages,
    projectLink: row.project_link,
    targetChapter: row.target_chapter,
  };
}

export type SourcePage = {
  sources: Source[];
  total: number;
  page: number;
  lastPage: number;
  /** La lecture a échoué : la liste n'est pas vide, elle est inconnue. */
  failed: boolean;
};

/** Numéro de page lu dans l'adresse, ramené à une valeur sûre. */
export function parsePage(value: string | string[] | undefined): number {
  const page = Number.parseInt((Array.isArray(value) ? value[0] : value) ?? "", 10);
  return Number.isInteger(page) && page >= 1 ? Math.min(page, 50) : 1;
}

/** Sources d'un projet, dans l'ordre alphabétique des titres. */
export async function getSources(projectId: string, page = 1): Promise<SourcePage> {
  if (!UUID.test(projectId)) return { sources: [], total: 0, page: 1, lastPage: 1, failed: false };

  const supabase = await createSessionClient();
  const from = (page - 1) * SOURCES_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("project_sources")
    .select(SOURCE_COLUMNS, { count: "exact" })
    .eq("project_id", projectId)
    .order("title")
    .order("id")
    .range(from, from + SOURCES_PAGE_SIZE - 1);
  if (error && page > 1) return getSources(projectId, 1);
  if (error) return { sources: [], total: 0, page: 1, lastPage: 1, failed: true };

  const total = count ?? 0;
  return {
    sources: ((data ?? []) as SourceRow[]).map(toSource),
    total,
    page,
    lastPage: Math.max(1, Math.ceil(total / SOURCES_PAGE_SIZE)),
    failed: false,
  };
}

/** Fiches de lecture d'une liste de sources, par identifiant de source. */
export async function getNotes(sourceIds: string[]): Promise<Map<string, LiteratureNote>> {
  const ids = sourceIds.filter((id) => UUID.test(id)).slice(0, 100);
  if (ids.length === 0) return new Map();

  const supabase = await createSessionClient();
  const { data } = await supabase.from("literature_notes").select(NOTE_COLUMNS).in("source_id", ids);
  return new Map(((data ?? []) as NoteRow[]).map((row) => [row.source_id, toNote(row)]));
}

/**
 * Une source du projet et sa fiche de lecture, ou `null`. La source doit
 * appartenir au projet de l'adresse : une source d'un autre de ses projets
 * n'est pas servie sous une adresse qui ne lui correspond pas.
 */
export async function getSource(
  projectId: string,
  sourceId: string,
): Promise<{ source: Source; note: LiteratureNote | null } | null> {
  if (!UUID.test(projectId) || !UUID.test(sourceId)) return null;

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("project_sources")
    .select(SOURCE_COLUMNS)
    .eq("id", sourceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) return null;

  const notes = await getNotes([sourceId]);
  return { source: toSource(data as SourceRow), note: notes.get(sourceId) ?? null };
}

/** Nombre de sources d'un projet. */
export async function countSources(projectId: string): Promise<number> {
  if (!UUID.test(projectId)) return 0;
  const supabase = await createSessionClient();
  const { count } = await supabase
    .from("project_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  return count ?? 0;
}
