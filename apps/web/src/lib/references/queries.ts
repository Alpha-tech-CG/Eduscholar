import "server-only";
import { producedRows } from "@/lib/admin/responses";
import { createSessionClient } from "@/lib/supabase/server";
import { parseReferenceItems, type ReferenceItem, type ReferenceKind } from "./schemas";

// Administration des référentiels. La liste est lue par une fonction de la
// base, sous la session de l'administrateur : c'est elle qui vérifie le rôle
// et la fraîcheur du second facteur. Aucune table n'est lue directement.

export type LoadedReferenceItems =
  | { status: "ok"; items: ReferenceItem[] }
  /** Soixante lectures par minute : la base le dit à l'administrateur. */
  | { status: "rate_limited" }
  /** Lecture refusée (statut 403), en échec, ou de forme inattendue. */
  | { status: "failed" };

/** Toutes les lignes d'un référentiel, actives et inactives, avec leur nombre d'usages. */
export async function listReferenceItems(kind: ReferenceKind): Promise<LoadedReferenceItems> {
  const supabase = await createSessionClient();
  const response = await supabase.rpc("admin_reference_items", { kind });
  if (response.error?.message === "rate_limited") return { status: "rate_limited" };
  // Une lecture refusée rend un objet, pas un tableau : elle ne passe pas pour une liste vide.
  const rows = producedRows(response);
  const items = rows ? parseReferenceItems(rows) : null;
  return items ? { status: "ok", items } : { status: "failed" };
}
