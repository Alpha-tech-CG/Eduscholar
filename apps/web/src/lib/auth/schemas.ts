import { z } from "zod";

// Validation côté serveur. Elle répète la configuration de Supabase Auth
// (12 caractères, lettres et chiffres) pour donner un message clair ; c'est le
// service d'authentification qui fait foi.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

export type FieldErrorCode =
  | "email_invalid"
  | "password_too_short"
  | "password_too_long"
  | "password_needs_letter_and_digit"
  | "password_mismatch"
  | "age_required";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "email_invalid")
  .pipe(z.email("email_invalid"));

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "password_too_short")
  .max(PASSWORD_MAX_LENGTH, "password_too_long")
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "password_needs_letter_and_digit");

export const signUpSchema = z
  .object({
    email,
    password: newPassword,
    passwordConfirmation: z.string(),
    // Politique sur les mineurs, option A : déclaration d'avoir l'âge requis.
    ageConfirmed: z.literal("on", "age_required"),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "password_mismatch",
  });

export const signInSchema = z.object({
  email,
  // Aucune règle de format à la connexion : on ne renseigne pas sur la politique.
  password: z.string().min(1).max(1024),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    passwordConfirmation: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "password_mismatch",
  });

export const confirmTokenSchema = z.object({
  tokenHash: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
  type: z.enum(["email", "recovery"]),
});

/** Erreurs par champ, sous forme de codes à traduire. */
export function fieldErrors(error: z.ZodError): Record<string, FieldErrorCode> {
  const result: Record<string, FieldErrorCode> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!(field in result)) result[field] = issue.message as FieldErrorCode;
  }
  return result;
}
