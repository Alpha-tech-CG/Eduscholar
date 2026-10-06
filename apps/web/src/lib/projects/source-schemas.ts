import { z } from "zod";
import { type ProjectFieldErrorCode, splitLines } from "./schemas";

// Source bibliographique d'un projet et fiche de lecture (cahier §6.8). Les
// bornes reprennent celles de la base, qui reste seule à faire foi.

export const SOURCE_TYPES = [
  "article",
  "book",
  "chapter",
  "thesis",
  "report",
  "conference",
  "web",
  "other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type SourceFieldErrorCode =
  | ProjectFieldErrorCode
  | "invalid_url"
  | "invalid_doi"
  | "invalid_year";

const empty = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const line = (max: number) => z.preprocess(empty, z.string().trim().max(max, "too_long").optional());

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(value) &&
    value >= "1990-01-01" &&
    value <= "2100-12-31"
  );
}

export const sourceSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES, "invalid_choice"),
  title: z.string().trim().min(1, "required").max(500, "too_long"),
  authors: z.array(z.string().trim().min(1).max(200, "too_long")).max(50, "too_many"),
  publicationYear: z.preprocess(
    empty,
    z
      .string()
      .regex(/^\d{4}$/, "invalid_year")
      .refine((value) => Number(value) >= 1400 && Number(value) <= 2100, "invalid_year")
      .optional(),
  ),
  containerTitle: line(300),
  publisher: line(200),
  volume: line(50),
  issue: line(50),
  pages: line(50),
  doi: z.preprocess(
    (value) =>
      typeof value === "string"
        ? value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "") ||
          undefined
        : value,
    z
      .string()
      .max(255, "invalid_doi")
      .regex(/^10\.[0-9]{4,9}\/\S+$/, "invalid_doi")
      .optional(),
  ),
  url: z.preprocess(
    empty,
    z
      .string()
      .trim()
      .max(2000, "too_long")
      .regex(/^https?:\/\/[^\s<>"@]+$/, "invalid_url")
      .optional(),
  ),
  accessedOn: z.preprocess(empty, z.string().refine(isRealDate, "invalid_date").optional()),
});

export type SourceInput = z.infer<typeof sourceSchema>;

/** Lit les champs d'une source dans un formulaire. Les auteurs : un par ligne. */
export function readSourceForm(get: (name: string) => string) {
  return {
    sourceType: get("sourceType"),
    title: get("title"),
    authors: splitLines(get("authors")),
    publicationYear: get("publicationYear"),
    containerTitle: get("containerTitle"),
    publisher: get("publisher"),
    volume: get("volume"),
    issue: get("issue"),
    pages: get("pages"),
    doi: get("doi"),
    url: get("url"),
    accessedOn: get("accessedOn"),
  };
}

/** Charge utile attendue par `add_project_source` et `update_project_source`. */
export function toSourcePayload(input: SourceInput) {
  return {
    source_type: input.sourceType,
    title: input.title,
    authors: input.authors,
    publication_year: input.publicationYear ?? "",
    container_title: input.containerTitle ?? "",
    publisher: input.publisher ?? "",
    volume: input.volume ?? "",
    issue: input.issue ?? "",
    pages: input.pages ?? "",
    doi: input.doi ?? "",
    url: input.url ?? "",
    accessed_on: input.accessedOn ?? "",
  };
}

const text = (max: number) => z.preprocess(empty, z.string().trim().max(max, "too_long").optional());

export const noteSchema = z.object({
  problem: text(3000),
  concepts: text(3000),
  method: text(3000),
  populationField: text(3000),
  results: text(3000),
  limits: text(3000),
  usefulQuote: text(2000),
  quotePages: line(50),
  projectLink: text(3000),
  targetChapter: line(200),
});

export type NoteInput = z.infer<typeof noteSchema>;

export const NOTE_FIELDS = [
  "problem",
  "concepts",
  "method",
  "populationField",
  "results",
  "limits",
  "usefulQuote",
  "quotePages",
  "projectLink",
  "targetChapter",
] as const;

/** Charge utile attendue par `save_literature_note`. */
export function toNotePayload(input: NoteInput) {
  return {
    problem: input.problem ?? "",
    concepts: input.concepts ?? "",
    method: input.method ?? "",
    population_field: input.populationField ?? "",
    results: input.results ?? "",
    limits: input.limits ?? "",
    useful_quote: input.usefulQuote ?? "",
    quote_pages: input.quotePages ?? "",
    project_link: input.projectLink ?? "",
    target_chapter: input.targetChapter ?? "",
  };
}

const CODES: readonly SourceFieldErrorCode[] = [
  "required",
  "too_short",
  "too_long",
  "invalid_choice",
  "invalid_date",
  "too_many",
  "invalid_url",
  "invalid_doi",
  "invalid_year",
];

export function sourceFieldErrors(error: z.ZodError): Record<string, SourceFieldErrorCode> {
  const fields: Record<string, SourceFieldErrorCode> = {};
  for (const issue of error.issues) {
    const name = String(issue.path[0] ?? "");
    if (!name || fields[name]) continue;
    const code = CODES.find((candidate) => candidate === issue.message);
    fields[name] = code ?? (issue.code === "too_big" ? "too_long" : "required");
  }
  return fields;
}
