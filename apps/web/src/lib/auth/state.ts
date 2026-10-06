import type { ResourceFieldErrorCode } from "@/lib/catalogue/schemas";
import type { ProfileFieldErrorCode } from "@/lib/profile/schemas";
import type { FieldErrorCode } from "./schemas";

// État renvoyé par les actions d'authentification. Uniquement des codes : les
// textes sont traduits à l'affichage, et aucun détail interne ne fuit.

export type AuthErrorCode =
  | "validation"
  | "invalid_credentials"
  | "rate_limited"
  | "invalid_link"
  | "already_signed_in"
  | "weak_password"
  | "same_password"
  | "session_expired"
  | "invalid_code"
  | "second_factor_required"
  | "last_org_admin"
  // Catalogue
  | "forbidden"
  | "own_submission"
  | "not_found"
  | "invalid_transition"
  | "reason_required"
  | "already_reported"
  | "not_publishable"
  | "access_status_required"
  | "permission_proof_required"
  | "duplicate"
  // Bibliothèque personnelle
  | "limit_reached"
  | "duplicate_name"
  // Import par connecteur
  | "doi_not_found"
  | "unsupported_type"
  | "language_required"
  | "source_unavailable"
  | "unavailable";

export type AuthNoticeCode = "check_email_signup" | "check_email_reset";

export type AuthFormState =
  | { status: "idle" }
  | {
      status: "error";
      error: AuthErrorCode;
      fields?: Record<string, FieldErrorCode | ProfileFieldErrorCode | ResourceFieldErrorCode>;
      /** Valeurs non sensibles à réafficher (jamais un mot de passe). */
      values?: Record<string, string>;
    }
  | { status: "success"; notice: AuthNoticeCode };

export const initialAuthState: AuthFormState = { status: "idle" };

/** Messages affichés sur la page de connexion après une redirection. */
export const SIGN_IN_NOTICES = [
  "email-confirmed",
  "password-updated",
  "account-deleted",
  "code-refused",
] as const;
export type SignInNotice = (typeof SIGN_IN_NOTICES)[number];

export function parseSignInNotice(value: unknown): SignInNotice | null {
  return SIGN_IN_NOTICES.find((notice) => notice === value) ?? null;
}
