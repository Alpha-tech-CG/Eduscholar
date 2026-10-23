import { z } from "zod";
import { preferenceLocales } from "@/i18n/routing";

// Validation du profil académique. La base refait tous ces contrôles
// (clés étrangères, entrées actives, cohérence filière / spécialité / matières) :
// ce schéma sert à donner un message par champ.

export const PROFILE_GOALS = ["courses", "revision", "thesis", "research", "project"] as const;
export type ProfileGoal = (typeof PROFILE_GOALS)[number];

export type ProfileFieldErrorCode = "required" | "invalid_choice" | "institution_length";

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
    const known = ["required", "invalid_choice", "institution_length"].includes(issue.message);
    result[field] = known ? (issue.message as ProfileFieldErrorCode) : "invalid_choice";
  }
  return result;
}
