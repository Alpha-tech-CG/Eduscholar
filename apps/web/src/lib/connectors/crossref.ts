import "server-only";
import { serverEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizeCrossrefWork, type NormalizedWork } from "./crossref-normalize";
import { pauseSeconds } from "./retry-after";

// Connecteur Crossref : résolution d'un DOI en métadonnées.
//
// Conditions de la source (docs/product/authorized-sources.md) : accès sans clé,
// adresse de contact fournie (accès « poli »), débit modéré. Une requête par
// import, jamais de moissonnage.
//
// L'hôte est fixé par la configuration du serveur ; seul le DOI, déjà validé et
// encodé, vient de l'utilisateur. Aucune redirection n'est suivie.

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_000_000;
/** Requêtes par jour, toute la plateforme confondue. */
const DAILY_LIMIT = 2000;

export type CrossrefResult =
  | { ok: true; work: NormalizedWork }
  | { ok: false; reason: "not_found" | "unsupported_type" | "unavailable" | "paused" | "daily_limit" };

async function readLimited(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** `doi` doit sortir de `parseDoi`. */
export async function fetchCrossrefWork(doi: string): Promise<CrossrefResult> {
  const env = serverEnv();
  const contact = env.CROSSREF_MAILTO ? ` (mailto:${env.CROSSREF_MAILTO})` : "";

  // La source est-elle en pause, le plafond du jour est-il atteint ? L'état
  // est tenu en base : il vaut pour tous les serveurs. Sans réponse de la
  // base, la source n'est pas sollicitée.
  const service = createServiceClient();
  const gate = await service.rpc("connector_gate", { p_source: "crossref", p_daily_limit: DAILY_LIMIT });
  if (gate.error || gate.data === "paused") return { ok: false, reason: gate.error ? "unavailable" : "paused" };
  if (gate.data !== "ok") return { ok: false, reason: "daily_limit" };

  let response: Response;
  try {
    const url = `${env.CROSSREF_API_URL}/works/${encodeURIComponent(doi)}`;
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": `EduScholar/0.1${contact}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 404) return { ok: false, reason: "not_found" };
  // « Trop de requêtes », ou indisponibilité avec un délai annoncé : la pause
  // demandée est respectée par toute la plateforme.
  if (response.status === 429 || (response.status === 503 && response.headers.has("retry-after"))) {
    await service.rpc("connector_pause", {
      p_source: "crossref",
      p_seconds: pauseSeconds(response.headers.get("retry-after")),
    });
    return { ok: false, reason: "paused" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, reason: "unavailable" };
  }

  let body: unknown;
  try {
    const text = await readLimited(response);
    if (text === null) return { ok: false, reason: "unavailable" };
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const normalized = normalizeCrossrefWork(body, doi);
  if (normalized.ok) return normalized;
  if (normalized.reason === "unsupported_type") return { ok: false, reason: "unsupported_type" };
  // Réponse inexploitable ou qui décrit un autre DOI : rien n'est importé.
  return { ok: false, reason: "unavailable" };
}
