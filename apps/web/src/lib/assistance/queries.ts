import "server-only";
import { getPublishedResources, type Resource } from "@/lib/catalogue/queries";
import { createSessionClient } from "@/lib/supabase/server";
import {
  parseClassificationSuggestions,
  parseCoherenceReport,
  parseRecommendations,
  parseSimilarResources,
  type ClassificationSuggestion,
  type CoherenceReport,
  type RecommendationReason,
  type SimilarResource,
} from "./schemas";

// Assistance documentaire : quatre lectures, faites par des fonctions de la
// base sous la session de l'utilisateur. Elles ne modifient rien. Aucune ne
// lève vers la page : un refus, une panne ou une réponse inattendue deviennent
// un état que l'écran affiche, sans gêner ce qui l'entoure.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Assisted<T> =
  | { status: "ok"; items: T[] }
  /** Trop de demandes en peu de temps. */
  | { status: "rate_limited" }
  /** Refus, panne, ou réponse de forme inattendue. */
  | { status: "failed" };

/**
 * Les signaux du cadre (redirection, rendu dynamique) portent un `digest` : ils
 * ne sont pas des pannes et doivent poursuivre leur route.
 */
function failed(error: unknown): { status: "failed" } {
  if (typeof error === "object" && error !== null && "digest" in error) throw error;
  return { status: "failed" };
}

type Failure = { status: "rate_limited" } | { status: "failed" };
const failureOf = (error: { message?: string } | null): Failure =>
  error?.message === "rate_limited" ? { status: "rate_limited" } : { status: "failed" };

/** Fiches qui ressemblent à celle-ci, pour un modérateur. */
export async function getSimilarResources(resourceId: string): Promise<Assisted<SimilarResource>> {
  if (!UUID.test(resourceId)) return { status: "failed" };
  try {
    const supabase = await createSessionClient();
    const { data, error } = await supabase.rpc("similar_resources", { resource_id: resourceId });
    if (error) return failureOf(error);
    const items = parseSimilarResources(data ?? []);
    return items ? { status: "ok", items } : { status: "failed" };
  } catch (error) {
    return failed(error);
  }
}

/** Matières que la base propose pour cette fiche, pour un modérateur. */
export async function getClassificationSuggestions(
  resourceId: string,
): Promise<Assisted<ClassificationSuggestion>> {
  if (!UUID.test(resourceId)) return { status: "failed" };
  try {
    const supabase = await createSessionClient();
    const { data, error } = await supabase.rpc("suggest_resource_classification", { resource_id: resourceId });
    if (error) return failureOf(error);
    const items = parseClassificationSuggestions(data ?? []);
    return items ? { status: "ok", items } : { status: "failed" };
  } catch (error) {
    return failed(error);
  }
}

export type LoadedCoherenceReport =
  | { status: "ok"; report: CoherenceReport }
  /** Projet inconnu, supprimé, d'un tiers, ou ouvert en partie seulement : même réponse. */
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "failed" };

/** Contrôles de forme d'un projet, pour son propriétaire ou un membre à accès complet. */
export async function getCoherenceReport(projectId: string): Promise<LoadedCoherenceReport> {
  if (!UUID.test(projectId)) return { status: "not_found" };
  try {
    const supabase = await createSessionClient();
    const { data, error } = await supabase.rpc("project_coherence_report", { project_id: projectId });
    if (error) {
      if (error.message === "rate_limited") return { status: "rate_limited" };
      // Tout refus de droit se confond avec « introuvable ».
      return error.message === "not_found" || error.message === "forbidden"
        ? { status: "not_found" }
        : { status: "failed" };
    }
    const report = parseCoherenceReport(data);
    return report ? { status: "ok", report } : { status: "failed" };
  } catch (error) {
    return failed(error);
  }
}

export type RecommendedResource = { resource: Resource; reasons: RecommendationReason[] };

/**
 * Fiches recommandées à l'utilisateur, d'après son profil et, s'il en désigne
 * un, son projet. La base rend des identifiants classés ; le contenu des
 * fiches est lu ensuite sous la session, publié et public seulement, dans
 * l'ordre de la base — comme pour la recherche.
 */
export async function getRecommendations(projectId: string | null): Promise<Assisted<RecommendedResource>> {
  try {
    const supabase = await createSessionClient();
    const { data, error } = await supabase.rpc("recommended_resources", {
      payload: projectId && UUID.test(projectId) ? { project_id: projectId } : {},
    });
    if (error) return failureOf(error);
    const hits = parseRecommendations(data ?? []);
    if (!hits) return { status: "failed" };

    const resources = await getPublishedResources(hits.map((hit) => hit.id));
    if (!resources) return { status: "failed" };
    const reasons = new Map(hits.map((hit) => [hit.id, hit.reasons]));
    return {
      status: "ok",
      items: resources.map((resource) => ({ resource, reasons: reasons.get(resource.id) ?? [] })),
    };
  } catch (error) {
    return failed(error);
  }
}
