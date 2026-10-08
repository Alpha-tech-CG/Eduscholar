import type { AuthErrorCode } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";

// Réponses des fonctions d'administration de la plateforme (`admin_*`).
//
// Elles ne lèvent pas sur un refus de droit : elles rendent un objet et la
// réponse porte le statut 403. Une écriture n'a eu lieu que si la réponse est
// un succès sans erreur ; tout le reste est tenu pour un refus, quoi qu'en
// dise le client de l'API.

export type RpcResponse = { data: unknown; error: unknown; status: number };

/** Code d'un refus, lu dans l'erreur ou, à défaut, dans le corps rendu. */
export function refusalCode(response: { data: unknown; error: unknown }): AuthErrorCode {
  const body = (response.error ?? response.data) as { code?: string; message?: string } | null;
  return body && typeof body === "object" && !Array.isArray(body) ? catalogueErrorCode(body) : "forbidden";
}

/** Écriture sans contenu rendu : succès, sans erreur ni corps. */
export function succeeded(response: RpcResponse): boolean {
  return response.error == null && response.data == null && (response.status === 200 || response.status === 204);
}

function successBody(response: RpcResponse): Record<string, unknown> | null {
  if (response.error != null || response.status !== 200) return null;
  const body = response.data;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * Écriture qui rend un objet de succès (`{ id }`, `{ token }`) : la valeur
 * attendue, ou `null` si la réponse n'est pas ce succès-là — un refus rend lui
 * aussi un objet, mais avec le statut 403 et sans cette clé.
 */
export function producedValue(response: RpcResponse, key: "id" | "token", pattern: RegExp): string | null {
  const value = successBody(response)?.[key];
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/** Écriture qui rend un drapeau (`{ created }`) : sa valeur, ou `null` si ce n'est pas un succès. */
export function producedFlag(response: RpcResponse, key: "created"): boolean | null {
  const value = successBody(response)?.[key];
  return typeof value === "boolean" ? value : null;
}

/** Lecture qui rend un tableau : ses lignes, ou `null` si elle a été refusée ou a échoué. */
export function producedRows(response: RpcResponse): unknown[] | null {
  return response.error == null && response.status === 200 && Array.isArray(response.data) ? response.data : null;
}
