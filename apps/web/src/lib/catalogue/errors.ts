import type { AuthErrorCode } from "@/lib/auth/state";

type DatabaseError = { code?: string; message?: string } | null;

/**
 * Traduit une erreur des fonctions du catalogue en code affichable.
 *
 * Les fonctions de la base lèvent une exception dont le message est un code
 * (« forbidden », « not_found »…). Tout autre message est ramené à un code
 * générique : aucun détail interne n'est relayé à l'utilisateur.
 */
export function catalogueErrorCode(error: DatabaseError): AuthErrorCode {
  const message = error?.message ?? "";

  switch (message) {
    case "forbidden":
    case "own_submission":
      return message;
    case "not_found":
    case "rate_limited":
    case "invalid_transition":
    case "reason_required":
    case "already_reported":
    case "not_publishable":
    case "access_status_required":
    case "permission_proof_required":
      return message;
    case "limit_reached":
    case "duplicate_name":
    case "conflict":
      return message;
    case "invalid_date":
      return "validation";
    case "nothing_to_submit":
      return message;
    case "recent_second_factor_required":
    case "own_account":
    case "account_suspended":
    case "second_factor_missing":
      return message;
    case "source_not_allowed":
      return "forbidden";
    case "duplicate_doi":
      return "duplicate";
    default:
      break;
  }

  switch (error?.code) {
    // Doublon : DOI déjà présent au catalogue.
    case "23505":
      return "duplicate";
    // Contrainte, clé étrangère, format ou argument refusé par la base.
    case "23514":
    case "23503":
    case "23502":
    case "22023":
    case "22P02":
    case "22003":
    case "22007":
    case "22008":
      return "validation";
    case "42501":
      return "forbidden";
    default:
      return "unavailable";
  }
}
