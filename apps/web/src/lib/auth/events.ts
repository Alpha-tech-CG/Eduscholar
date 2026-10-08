import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Compteurs d'événements de l'authentification : échecs et limites atteintes,
// par heure et par nature. Un nombre de plus, rien d'autre : ni adresse, ni
// compte. Compter ne retarde ni n'empêche jamais l'action en cours.

export type AuthEventKind = `failed:${string}` | `limited:${string}` | `new-device:${string}`;

export async function recordAuthEvent(kind: AuthEventKind): Promise<void> {
  try {
    await createServiceClient().rpc("record_auth_event", { p_kind: kind });
  } catch {
    // Le compteur est un complément : son absence ne change rien à la réponse.
  }
}
