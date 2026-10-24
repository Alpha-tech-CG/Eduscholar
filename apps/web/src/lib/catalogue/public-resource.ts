// Catalogue public (ADR-0014) : lecture des réponses de la base, adresses des
// pages publiques et données structurées. Module pur, sans accès à la base.

import { z } from "zod";
import { defaultLocale, locales } from "@/i18n/routing";

/** Une fiche telle qu'un visiteur la lit : description seulement. */
export type PublicResource = {
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
  publishedAt: string | null;
  updatedAt: string;
  /** Fiche d'une institution dont l'organisation est vérifiée. */
  verifiedInstitution: boolean;
};

const texts = z.array(z.string()).catch([]);
// Forme d'un identifiant, sans exiger de version : la base en est la source.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

// Ce que la base rend ; toute autre clé est ignorée. Une fiche mal formée est
// écartée plutôt qu'affichée à moitié.
const rowSchema = z
  .object({
    id: uuid,
    type_code: z.string(),
    title: z.string(),
    abstract: z.string().nullable(),
    authors: texts,
    institution_name: z.string().nullable(),
    publication_year: z.number().int().nullable(),
    thesis_degree: z.string().nullable(),
    language_code: z.string(),
    country_code: z.string().nullable(),
    program_code: z.string(),
    level_codes: texts,
    subject_codes: texts,
    tags: texts,
    doi: z.string().nullable(),
    official_url: z.string().nullable(),
    access_status: z.string(),
    license_code: z.string(),
    source_kind: z.string(),
    source_name: z.string(),
    last_verified_at: z.string().nullable(),
    published_at: z.string().nullable(),
    updated_at: z.string(),
    verified_institution: z.boolean().catch(false),
  })
  .transform(
    (row): PublicResource => ({
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
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      verifiedInstitution: row.verified_institution,
    }),
  );

/** Une fiche, ou `null` si la réponse n'en est pas une. */
export function parsePublicResource(value: unknown): PublicResource | null {
  const parsed = rowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Une liste de fiches : les éléments mal formés sont écartés. */
export function parsePublicResources(value: unknown): PublicResource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => parsePublicResource(item) ?? []);
}

const searchSchema = z.object({
  items: z.unknown(),
  total: z.number().int().min(0),
  capped: z.boolean(),
});

export type PublicSearchPage = { resources: PublicResource[]; total: number; capped: boolean };

export function parsePublicSearch(value: unknown): PublicSearchPage | null {
  const parsed = searchSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    resources: parsePublicResources(parsed.data.items),
    total: parsed.data.total,
    capped: parsed.data.capped,
  };
}

export type HomeSections = {
  recent: PublicResource[];
  popular: PublicResource[];
  institutional: PublicResource[];
};

export function parseHomeSections(value: unknown): HomeSections {
  const object = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    recent: parsePublicResources(object.recent),
    popular: parsePublicResources(object.popular),
    institutional: parsePublicResources(object.institutional),
  };
}

const sitemapSchema = z.array(z.object({ id: uuid, updated_at: z.string() })).catch([]);

export function parseSitemapResources(value: unknown): { id: string; updatedAt: string }[] {
  return sitemapSchema.parse(value).map((row) => ({ id: row.id, updatedAt: row.updated_at }));
}

// ---------------------------------------------------------------------------
// Adresses
// ---------------------------------------------------------------------------

/** Adresse absolue d'une page, dans une langue. `path` commence par « / » ou est vide. */
export function localizedUrl(appUrl: string, locale: string, path: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/${locale}${path === "/" ? "" : path}`;
}

/** Les versions d'une page dans chaque langue, et la version par défaut. */
export function alternateLanguages(appUrl: string, path: string): Record<string, string> {
  return {
    ...Object.fromEntries(locales.map((locale) => [locale, localizedUrl(appUrl, locale, path)])),
    "x-default": localizedUrl(appUrl, defaultLocale, path),
  };
}

/** Description courte d'une fiche, pour les moteurs et les aperçus de lien. */
export function resourceDescription(resource: PublicResource, maxLength = 200): string {
  const source =
    resource.abstract?.replace(/\s+/g, " ").trim() ||
    [resource.authors.slice(0, 3).join(", ") || resource.institutionName, resource.publicationYear]
      .filter(Boolean)
      .join(", ");
  const chars = Array.from(source);
  return chars.length <= maxLength ? source : `${chars.slice(0, maxLength - 1).join("").trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Données structurées (schema.org)
// ---------------------------------------------------------------------------

const SCHEMA_TYPES: Record<string, string> = {
  article: "ScholarlyArticle",
  preprint: "ScholarlyArticle",
  thesis: "Thesis",
  memoir: "Thesis",
  book: "Book",
  chapter: "Chapter",
  report: "Report",
  dataset: "Dataset",
  course: "Course",
  video: "VideoObject",
  presentation: "PresentationDigitalDocument",
};

// Seules les licences dont l'adresse officielle est certaine sont liées.
const LICENSE_URLS: Record<string, string> = {
  "cc0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "cc-by-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "cc-by-sa-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "cc-by-nd-4.0": "https://creativecommons.org/licenses/by-nd/4.0/",
  "cc-by-nc-4.0": "https://creativecommons.org/licenses/by-nc/4.0/",
  "cc-by-nc-sa-4.0": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "cc-by-nc-nd-4.0": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
};

const FREE_ACCESS = new Set(["open_access", "free_link"]);

/**
 * Données structurées d'une fiche. Rien n'est inventé : un champ absent de la
 * fiche est absent ici (AGENTS.md, règle 11).
 */
export function resourceJsonLd(resource: PublicResource, pageUrl: string): Record<string, unknown> {
  const officialUrl =
    resource.officialUrl && /^https?:\/\//.test(resource.officialUrl) ? resource.officialUrl : null;
  const doiUrl = resource.doi ? `https://doi.org/${resource.doi}` : null;
  const description = resourceDescription(resource, 300);

  return {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPES[resource.typeCode] ?? "CreativeWork",
    "@id": pageUrl,
    url: pageUrl,
    name: resource.title,
    ...(description ? { description } : {}),
    ...(resource.authors.length > 0
      ? { author: resource.authors.map((name) => ({ "@type": "Person", name })) }
      : resource.institutionName
        ? { author: { "@type": "Organization", name: resource.institutionName } }
        : {}),
    ...(resource.publicationYear ? { datePublished: String(resource.publicationYear) } : {}),
    dateModified: resource.updatedAt,
    inLanguage: resource.languageCode,
    ...(resource.tags.length > 0 ? { keywords: resource.tags.join(", ") } : {}),
    ...(resource.doi
      ? { identifier: { "@type": "PropertyValue", propertyID: "DOI", value: resource.doi } }
      : {}),
    ...(doiUrl || officialUrl ? { sameAs: [doiUrl, officialUrl].filter(Boolean) } : {}),
    ...(LICENSE_URLS[resource.licenseCode] ? { license: LICENSE_URLS[resource.licenseCode] } : {}),
    isAccessibleForFree: FREE_ACCESS.has(resource.accessStatus),
  };
}

/**
 * Le JSON-LD est inséré tel quel dans un élément `<script>` : « < » est
 * échappé, pour qu'aucun texte de fiche ne referme l'élément.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
