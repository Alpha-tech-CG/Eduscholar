// Recherche dans le catalogue : lecture des paramètres d'adresse et
// construction de la requête plein texte. Module pur, sans accès à la base.

export const SEARCH_PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 40;
const MAX_PAGE = 500;

/** Statuts d'accès proposés comme filtre. */
export const SEARCHABLE_ACCESS_STATUSES = [
  "open_access",
  "free_link",
  "preview_only",
  "institutional_access",
  "paid",
] as const;

export type SearchFilters = {
  query: string;
  typeCode: string | null;
  languageCode: string | null;
  accessStatus: string | null;
  levelCode: string | null;
  subjectCode: string | null;
  page: number;
};

export type SearchReference = {
  types: readonly string[];
  languages: readonly string[];
  levels: readonly string[];
  subjects: readonly string[];
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function oneOf(value: string, allowed: readonly string[]): string | null {
  return allowed.includes(value) ? value : null;
}

/**
 * Lit les paramètres de l'adresse. Un filtre dont la valeur n'appartient pas au
 * référentiel est ignoré : rien de ce que saisit l'utilisateur n'atteint la
 * requête sans avoir été reconnu.
 */
export function parseSearchParams(params: RawParams, reference: SearchReference): SearchFilters {
  const page = Number.parseInt(first(params.page), 10);

  return {
    query: first(params.q).replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH),
    typeCode: oneOf(first(params.type), reference.types),
    languageCode: oneOf(first(params.language), reference.languages),
    accessStatus: oneOf(first(params.access), SEARCHABLE_ACCESS_STATUSES),
    levelCode: oneOf(first(params.level), reference.levels),
    subjectCode: oneOf(first(params.subject), reference.subjects),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/**
 * Mots cherchés : sans accents, en minuscules, lettres et chiffres seulement.
 * Même traitement que l'index de la base, qui retire les accents.
 */
export function searchTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  const terms = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0)
    .map((term) => Array.from(term).slice(0, MAX_TERM_LENGTH).join(""));

  return [...new Set(terms)].slice(0, MAX_TERMS);
}

/**
 * Requête plein texte : tous les mots, chacun cherché par son début, pour que
 * « arbre » trouve « arbres ». Les mots ne contiennent que des lettres et des
 * chiffres : aucun opérateur ne peut y être glissé.
 */
export function toTsQuery(query: string): string | null {
  const terms = searchTerms(query);
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(" & ") : null;
}

/** Paramètres d'adresse d'une recherche, pour les liens de pagination. */
export function toSearchParams(filters: SearchFilters, page: number): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.query) params.q = filters.query;
  if (filters.typeCode) params.type = filters.typeCode;
  if (filters.languageCode) params.language = filters.languageCode;
  if (filters.accessStatus) params.access = filters.accessStatus;
  if (filters.levelCode) params.level = filters.levelCode;
  if (filters.subjectCode) params.subject = filters.subjectCode;
  if (page > 1) params.page = String(page);
  return params;
}
