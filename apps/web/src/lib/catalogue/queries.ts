import "server-only";
import { cache } from "react";
import { getSecondFactorState } from "@/lib/auth/second-factor";
import { getCurrentUser } from "@/lib/auth/session";
import type { Option } from "@/lib/profile/queries";
import { createSessionClient } from "@/lib/supabase/server";
import { SEARCH_PAGE_SIZE, toTsQuery, type SearchFilters } from "./search";

// Lectures du catalogue, faites sous le jeton de l'utilisateur : la RLS décide
// de ce qu'il voit. Les colonnes sont nommées une à une (modèle de menaces M-52).

const RESOURCE_COLUMNS =
  "id, type_code, title, abstract, authors, institution_name, publication_year, thesis_degree, language_code, country_code, program_code, level_codes, subject_codes, tags, doi, official_url, access_status, license_code, source_kind, source_name, last_verified_at, editorial_status, visibility, created_at, updated_at, published_at";

export type Resource = {
  id: string;
  typeCode: string;
  title: string;
  abstract: string | null;
  authors: string[];
  institutionName: string | null;
  publicationYear: number | null;
  thesisDegree: string | null;
  languageCode: string;
  countryCode: string | null;
  programCode: string;
  levelCodes: string[];
  subjectCodes: string[];
  tags: string[];
  doi: string | null;
  officialUrl: string | null;
  accessStatus: string;
  licenseCode: string;
  sourceKind: string;
  sourceName: string;
  lastVerifiedAt: string | null;
  editorialStatus: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

type ResourceRow = {
  id: string;
  type_code: string;
  title: string;
  abstract: string | null;
  authors: string[];
  institution_name: string | null;
  publication_year: number | null;
  thesis_degree: string | null;
  language_code: string;
  country_code: string | null;
  program_code: string;
  level_codes: string[];
  subject_codes: string[];
  tags: string[];
  doi: string | null;
  official_url: string | null;
  access_status: string;
  license_code: string;
  source_kind: string;
  source_name: string;
  last_verified_at: string | null;
  editorial_status: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    typeCode: row.type_code,
    title: row.title,
    abstract: row.abstract,
    authors: row.authors,
    institutionName: row.institution_name,
    publicationYear: row.publication_year,
    thesisDegree: row.thesis_degree,
    languageCode: row.language_code,
    countryCode: row.country_code,
    programCode: row.program_code,
    levelCodes: row.level_codes,
    subjectCodes: row.subject_codes,
    tags: row.tags,
    doi: row.doi,
    officialUrl: row.official_url,
    accessStatus: row.access_status,
    licenseCode: row.license_code,
    sourceKind: row.source_kind,
    sourceName: row.source_name,
    lastVerifiedAt: row.last_verified_at,
    editorialStatus: row.editorial_status,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Une fiche visible de l'utilisateur courant, ou `null`. */
export async function getResource(id: string): Promise<Resource | null> {
  if (!UUID.test(id)) return null;

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("resources")
    .select(RESOURCE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  return toResource(data as ResourceRow);
}

export type HistoryEntry = {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  action: string;
  reason: string | null;
  occurredAt: string;
};

export async function getResourceHistory(resourceId: string): Promise<HistoryEntry[]> {
  if (!UUID.test(resourceId)) return [];

  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("resource_status_history")
    .select("id, from_status, to_status, action, reason, occurred_at")
    .eq("resource_id", resourceId)
    .order("occurred_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    action: row.action,
    reason: row.reason,
    occurredAt: row.occurred_at,
  }));
}

export type SearchResult = { resources: Resource[]; total: number; failed: boolean };

/**
 * Recherche parmi les fiches publiées. Le statut et la visibilité sont filtrés
 * explicitement : un modérateur, qui lit aussi les fiches en attente, ne les
 * voit pas apparaître ici. La RLS reste la règle ; ce filtre est un choix
 * d'affichage.
 */
export async function searchResources(filters: SearchFilters): Promise<SearchResult> {
  const supabase = await createSessionClient();
  let query = supabase
    .from("resources")
    .select(RESOURCE_COLUMNS, { count: "exact" })
    .eq("editorial_status", "published")
    .eq("visibility", "public");

  const tsQuery = toTsQuery(filters.query);
  if (tsQuery) query = query.textSearch("search_vector", tsQuery, { config: "simple" });
  if (filters.typeCode) query = query.eq("type_code", filters.typeCode);
  if (filters.languageCode) query = query.eq("language_code", filters.languageCode);
  if (filters.accessStatus) query = query.eq("access_status", filters.accessStatus);
  if (filters.levelCode) query = query.contains("level_codes", [filters.levelCode]);
  if (filters.subjectCode) query = query.contains("subject_codes", [filters.subjectCode]);

  const from = (filters.page - 1) * SEARCH_PAGE_SIZE;
  const { data, count, error } = await query
    .order("published_at", { ascending: false })
    .order("id")
    .range(from, from + SEARCH_PAGE_SIZE - 1);
  if (error) {
    // Page au-delà de la dernière : on revient à la première.
    if (error.code === "PGRST103" && filters.page > 1) {
      return searchResources({ ...filters, page: 1 });
    }
    return { resources: [], total: 0, failed: true };
  }

  return {
    resources: ((data ?? []) as ResourceRow[]).map(toResource),
    total: count ?? 0,
    failed: false,
  };
}

/** Les soumissions de l'utilisateur courant, récentes d'abord. */
export async function getMySubmissions(): Promise<Resource[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createSessionClient();
  // L'identité du contributeur n'est pas lisible : la base renvoie elle-même
  // les identifiants des fiches de l'appelant.
  const ids = await supabase.rpc("my_submission_ids");
  const mine = (ids.data ?? []) as string[];
  if (ids.error || mine.length === 0) return [];

  const { data } = await supabase
    .from("resources")
    .select(RESOURCE_COLUMNS)
    .in("id", mine.slice(0, 100))
    .order("created_at", { ascending: false })
    .limit(100);

  return ((data ?? []) as ResourceRow[]).map(toResource);
}

/**
 * Vrai si l'utilisateur courant peut modérer : rôle détenu et second facteur
 * vérifié. Sert à l'affichage ; chaque fonction de la base refait le contrôle.
 */
export const isModerator = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;
  if (!(await getSecondFactorState()).sessionVerified) return false;

  const supabase = await createSessionClient();
  const { data } = await supabase.from("platform_roles").select("role").eq("role", "moderator");
  return (data ?? []).length > 0;
});

export const MODERATION_QUEUE_STATUSES = [
  "pending",
  "under_review",
  "changes_requested",
  "verified",
  "suspended",
] as const;

export const MODERATION_PAGE_SIZE = 20;

export type ModerationQueue = { resources: Resource[]; total: number; page: number };

/**
 * File de modération, les plus anciennes d'abord, par pages. `words` filtre par
 * les mots du titre, des auteurs ou des mots-clés.
 */
export async function getModerationQueue(words: string, page: number): Promise<ModerationQueue> {
  const supabase = await createSessionClient();
  let query = supabase
    .from("resources")
    .select(RESOURCE_COLUMNS, { count: "exact" })
    .eq("visibility", "public")
    .in("editorial_status", [...MODERATION_QUEUE_STATUSES]);

  const tsQuery = toTsQuery(words);
  if (tsQuery) query = query.textSearch("search_vector", tsQuery, { config: "simple" });

  const from = (page - 1) * MODERATION_PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: true })
    .order("id")
    .range(from, from + MODERATION_PAGE_SIZE - 1);
  if (error) {
    // Page au-delà de la dernière : on revient à la première.
    if (error.code === "PGRST103" && page > 1) return getModerationQueue(words, 1);
    return { resources: [], total: 0, page: 1 };
  }

  return { resources: ((data ?? []) as ResourceRow[]).map(toResource), total: count ?? 0, page };
}

export type InternalNotes = {
  contributorComment: string | null;
  permissionProof: string | null;
  rightsDeclaredAt: string | null;
  moderationNotes: string | null;
};

export async function getInternalNotes(resourceId: string): Promise<InternalNotes | null> {
  if (!UUID.test(resourceId)) return null;

  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("resource_internal")
    .select("contributor_comment, permission_proof, rights_declared_at, moderation_notes")
    .eq("resource_id", resourceId)
    .maybeSingle();
  if (!data) return null;

  return {
    contributorComment: data.contributor_comment,
    permissionProof: data.permission_proof,
    rightsDeclaredAt: data.rights_declared_at,
    moderationNotes: data.moderation_notes,
  };
}

export type Report = {
  id: string;
  resourceId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
};

export async function getOpenReports(): Promise<Report[]> {
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("resource_reports")
    .select("id, resource_id, reason, details, status, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);

  return (data ?? []).map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export type LicenseOption = Option & { canHost: string };

export type CatalogueReference = {
  types: Option[];
  licenses: LicenseOption[];
  languages: Option[];
};

type Labels = Record<string, string>;
const label = (labels: unknown, locale: string) => {
  const values = (labels ?? {}) as Labels;
  return values[locale] ?? values.fr ?? "";
};

/** Types de ressources, licences et langues, dans la langue demandée. */
export const getCatalogueReference = cache(async (locale: string): Promise<CatalogueReference> => {
  const supabase = await createSessionClient();
  const [types, licenses, languages] = await Promise.all([
    supabase.from("resource_types").select("code, labels").order("position"),
    supabase.from("licenses").select("code, labels, can_host").order("position"),
    supabase.from("languages").select("code, labels").order("code"),
  ]);

  return {
    types: (types.data ?? []).map((row) => ({ code: row.code, label: label(row.labels, locale) })),
    licenses: (licenses.data ?? []).map((row) => ({
      code: row.code,
      label: label(row.labels, locale),
      canHost: row.can_host,
    })),
    languages: (languages.data ?? []).map((row) => ({
      code: row.code,
      label: label(row.labels, locale),
    })),
  };
});
