import { z } from "zod";
import { preferenceLocales } from "@/i18n/routing";

// Validation du profil académique. La base refait tous ces contrôles
// (clés étrangères, entrées actives, cohérence filière / spécialité / matières) :
// ce schéma sert à donner un message par champ.

export const PROFILE_GOALS = ["courses", "revision", "thesis", "research", "project"] as const;
export type ProfileGoal = (typeof PROFILE_GOALS)[number];

export type ProfileFieldErrorCode =
  | "required"
  | "invalid_choice"
  | "institution_length"
  | "region_invalid"
  | "display_name_invalid"
  | "display_name_required";

const KNOWN_ERRORS: readonly string[] = [
  "required",
  "invalid_choice",
  "institution_length",
  "region_invalid",
  "display_name_invalid",
  "display_name_required",
];

// Caractères refusés par la base dans un texte court affiché (région, nom) :
// commande, invisibles et bidirectionnels, chevrons.
const FORBIDDEN_SHORT_TEXT =
  /[\p{Cc}\u0080-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\u3164\uFFA0\uFEFF\u{E0000}-\u{E007F}<>]/u;

/** Espaces réduits et retirés aux extrémités : la forme exigée par la base. */
export function normalizeShortText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Texte court affiché : borné, sans caractère interdit, sans formule de
 * tableur en tête, avec au moins un caractère qui n'est ni espace, ni
 * ponctuation, ni chiffre. Mêmes règles que les contraintes de la base.
 */
export function isCleanShortText(value: string, min: number, max: number): boolean {
  const length = Array.from(value).length;
  return (
    length >= min &&
    length <= max &&
    !FORBIDDEN_SHORT_TEXT.test(value) &&
    !/^[=+@-]/.test(value) &&
    /[^\s\p{P}\p{S}\p{N}]/u.test(value)
  );
}

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const shortText = (min: number, max: number, message: ProfileFieldErrorCode) =>
  z
    .string()
    .transform(normalizeShortText)
    .refine((value) => isCleanShortText(value, min, max), message);

const code = z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, "invalid_choice");
const optionalText = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const profileSchema = z.object({
  countryCode: z
    .string()
    .min(1, "required")
    .regex(/^[A-Z]{2}$/, "invalid_choice"),
  levelCode: z.string().min(1, "required").pipe(code),
  programCode: z.string().min(1, "required").pipe(code),
  specialtyCode: optionalText(code),
  subjectCodes: z.array(code).max(40, "invalid_choice"),
  institutionName: optionalText(
    z.string().trim().min(2, "institution_length").max(200, "institution_length"),
  ),
  region: z.preprocess(blankToUndefined, shortText(2, 100, "region_invalid").optional()),
  goals: z.array(z.enum(PROFILE_GOALS, "invalid_choice")).max(PROFILE_GOALS.length),
  preferredLocale: z.enum(preferenceLocales, "invalid_choice"),
  // Obligatoire tant que la déclaration n'a pas été enregistrée.
  ageConfirmed: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export function profileFieldErrors(error: z.ZodError): Record<string, ProfileFieldErrorCode> {
  const result: Record<string, ProfileFieldErrorCode> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (field in result) continue;
    const known = KNOWN_ERRORS.includes(issue.message);
    result[field] = known ? (issue.message as ProfileFieldErrorCode) : "invalid_choice";
  }
  return result;
}

// Réglages de confidentialité (table profile_public). Rien n'est public par
// défaut ; un profil public a un nom affiché. La base refait ces contrôles.
export const privacySchema = z
  .object({
    displayName: z.preprocess(blankToUndefined, shortText(1, 80, "display_name_invalid").optional()),
    isPublic: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.isPublic && value.displayName === undefined) {
      context.addIssue({ code: "custom", path: ["displayName"], message: "display_name_required" });
    }
  });

export type PrivacyInput = z.infer<typeof privacySchema>;
