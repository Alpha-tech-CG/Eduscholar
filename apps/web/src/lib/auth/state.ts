import type { ResourceFieldErrorCode } from "@/lib/catalogue/schemas";
import type { ProfileFieldErrorCode } from "@/lib/profile/schemas";
import type { ProjectFieldErrorCode } from "@/lib/projects/schemas";
import type { SourceFieldErrorCode } from "@/lib/projects/source-schemas";
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
  | "breached_password"
  | "captcha_required"
  | "same_password"
  | "session_expired"
  | "invalid_code"
  | "code_wait"
  | "second_factor_required"
  | "last_org_admin"
  | "last_super_admin"
  | "last_super_admin_recovery"
  // Administration
  | "recent_second_factor_required"
  | "own_account"
  | "account_suspended"
  | "second_factor_missing"
  | "user_not_found"
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
  | "conflict"
  | "duplicate_name"
  | "nothing_to_submit"
  | "scope_required"
  // Import par connecteur
  | "doi_not_found"
  | "unsupported_type"
  | "language_required"
  | "source_unavailable"
  | "source_paused"
  | "source_daily_limit"
  | "unavailable";

export type AuthNoticeCode = "check_email_signup" | "check_email_reset";

export type AuthFormState =
  | { status: "idle" }
  | {
      status: "error";
      error: AuthErrorCode;
      fields?: Record<
        string,
        | FieldErrorCode
        | ProfileFieldErrorCode
        | ResourceFieldErrorCode
        | ProjectFieldErrorCode
        | SourceFieldErrorCode
      >;
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
