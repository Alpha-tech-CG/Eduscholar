import { z } from "zod";

// Validation d'une fiche de ressource. La base refait chaque contrôle
// (contraintes, référentiels actifs, DOI unique) : ce schéma sert à donner un
// message par champ.

export const ACCESS_STATUSES = [
  "open_access",
  "free_link",
  "preview_only",
  "institutional_access",
  "paid",
  "unknown",
] as const;

export const THESIS_DEGREES = ["bachelor", "master", "doctorate"] as const;

export const MODERATION_ACTIONS = [
  "start_review",
  "request_changes",
  "verify",
  "publish",
  "reject",
  "suspend",
  "restore",
  "remove",
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const ACTIONS_REQUIRING_REASON: ReadonlySet<ModerationAction> = new Set([
  "request_changes",
  "reject",
  "suspend",
  "remove",
]);

export type ResourceFieldErrorCode =
  | "required"
  | "invalid_choice"
  | "too_short"
  | "too_long"
  | "invalid_url"
  | "invalid_doi"
  | "invalid_year"
  | "invalid_tags"
  | "rights_required";

const code = z.string().regex(/^[a-z][a-z0-9_.-]{1,49}$/, "invalid_choice");
const empty = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** Découpe une saisie multiligne ou séparée par des virgules, sans doublon. */
export function splitList(value: string, separator: RegExp): string[] {
  const seen = new Set<string>();
  for (const part of value.split(separator)) {
    const item = part.trim().replace(/\s+/g, " ");
    if (item) seen.add(item);
  }
  return [...seen];
}

export const resourceSchema = z.object({
  typeCode: z.string().min(1, "required").pipe(code),
  title: z.string().trim().min(3, "too_short").max(500, "too_long"),
  abstract: z.preprocess(empty, z.string().trim().max(5000, "too_long").optional()),
  authors: z.array(z.string().min(1).max(200, "too_long")).max(50, "too_long"),
  institutionName: z.preprocess(
    empty,
    z.string().trim().min(2, "too_short").max(200, "too_long").optional(),
  ),
  publicationYear: z.preprocess(
    empty,
    z.coerce.number("invalid_year").int("invalid_year").min(1400, "invalid_year").max(2100, "invalid_year").optional(),
  ),
  thesisDegree: z.preprocess(empty, z.enum(THESIS_DEGREES, "invalid_choice").optional()),
  languageCode: z.string().min(1, "required").pipe(z.string().regex(/^[a-z]{2,3}$/, "invalid_choice")),
  countryCode: z.preprocess(empty, z.string().regex(/^[A-Z]{2}$/, "invalid_choice").optional()),
  programCode: z.string().min(1, "required").pipe(code),
  levelCodes: z.array(code).max(12, "invalid_choice"),
  subjectCodes: z.array(code).max(40, "invalid_choice"),
  tags: z
    .array(
      z
        .string()
        .max(40, "invalid_tags")
        .regex(/^[a-z0-9à-öø-ÿ][a-z0-9à-öø-ÿ +#.-]*$/, "invalid_tags"),
    )
    .max(20, "invalid_tags"),
  doi: z.preprocess(
    empty,
    z
      .string()
      .trim()
      .toLowerCase()
      .max(255, "invalid_doi")
      .regex(/^10\.[0-9]{4,9}\/\S+$/, "invalid_doi")
      .optional(),
  ),
  officialUrl: z
    .string()
    .trim()
    .min(1, "required")
    .max(2000, "too_long")
    // http et https uniquement, comme la contrainte de la base.
    .regex(/^https?:\/\/[^\s<>"]+$/, "invalid_url"),
  accessStatus: z.enum(ACCESS_STATUSES, "invalid_choice"),
  licenseCode: z.string().min(1, "required").pipe(code),
  contributorComment: z.preprocess(empty, z.string().trim().max(2000, "too_long").optional()),
  permissionProof: z.preprocess(empty, z.string().trim().max(2000, "too_long").optional()),
  rightsDeclared: z.literal(true, "rights_required"),
});

export type ResourceInput = z.infer<typeof resourceSchema>;

/** Charge utile attendue par les fonctions `submit_resource` et `update_submission`. */
export function toResourcePayload(input: ResourceInput) {
  return {
    type_code: input.typeCode,
    title: input.title,
    abstract: input.abstract ?? "",
    authors: input.authors,
    institution_name: input.institutionName ?? "",
    publication_year: input.publicationYear === undefined ? "" : String(input.publicationYear),
    thesis_degree: input.typeCode === "thesis" ? (input.thesisDegree ?? "") : "",
    language_code: input.languageCode,
    country_code: input.countryCode ?? "",
    program_code: input.programCode,
    level_codes: input.levelCodes,
    subject_codes: input.subjectCodes,
    tags: input.tags,
    doi: input.doi ?? "",
    official_url: input.officialUrl,
    access_status: input.accessStatus,
    license_code: input.licenseCode,
    contributor_comment: input.contributorComment ?? "",
    permission_proof: input.permissionProof ?? "",
    rights_declared: input.rightsDeclared,
  };
}

const FIELD_CODES: ReadonlySet<string> = new Set([
  "required",
  "invalid_choice",
  "too_short",
  "too_long",
  "invalid_url",
  "invalid_doi",
  "invalid_year",
  "invalid_tags",
  "rights_required",
]);

export function resourceFieldErrors(error: z.ZodError): Record<string, ResourceFieldErrorCode> {
  const result: Record<string, ResourceFieldErrorCode> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (field in result) continue;
    result[field] = FIELD_CODES.has(issue.message)
      ? (issue.message as ResourceFieldErrorCode)
      : "invalid_choice";
  }
  return result;
}

export const moderationSchema = z.object({
  resourceId: z.uuid(),
  action: z.enum(MODERATION_ACTIONS),
  reason: z.preprocess(empty, z.string().trim().max(2000).optional()),
});

export const moderatorEditSchema = z.object({
  resourceId: z.uuid(),
  officialUrl: z
    .string()
    .trim()
    .max(2000)
    .regex(/^https?:\/\/[^\s<>"]+$/, "invalid_url"),
  accessStatus: z.enum(ACCESS_STATUSES, "invalid_choice"),
  licenseCode: code,
  moderationNotes: z.preprocess(empty, z.string().trim().max(5000, "too_long").optional()),
});

export const REPORT_REASONS = [
  "copyright",
  "privacy",
  "error",
  "broken_link",
  "inappropriate",
  "malware",
  "other",
] as const;

export const reportSchema = z.object({
  resourceId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.preprocess(empty, z.string().trim().max(2000).optional()),
});

export const reportResolutionSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(["resolved", "dismissed"]),
  note: z.preprocess(empty, z.string().trim().max(2000).optional()),
});
