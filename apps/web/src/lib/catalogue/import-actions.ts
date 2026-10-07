"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { fetchCrossrefWork } from "@/lib/connectors/crossref";
import { parseDoi } from "@/lib/connectors/crossref-normalize";
import { createServiceClient, createSessionClient } from "@/lib/supabase/server";
import { catalogueErrorCode } from "./errors";
import { isModerator } from "./queries";

// Import d'une fiche par son DOI, réservé à la modération.
//
// Le navigateur ne fournit que le DOI et le classement (filière, langue de
// repli). Les métadonnées viennent de la source, lues par le serveur : c'est ce
// qui rend vraie la provenance enregistrée. La fiche arrive « en attente » et
// suit ensuite le circuit ordinaire de modération.

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const CODE = /^[a-z][a-z0-9_]{1,49}$/;

export async function importResourceByDoi(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return { status: "error", error: "session_expired" };
  // Rôle et second facteur, vérifiés par la base sous la session de l'appelant.
  if (!(await isModerator())) return { status: "error", error: "forbidden" };

  const values = {
    doi: text(formData, "doi").slice(0, 300),
    programCode: text(formData, "programCode"),
    languageCode: text(formData, "languageCode"),
  };
  const doi = parseDoi(values.doi);
  if (!doi) {
    return { status: "error", error: "validation", fields: { doi: "invalid_doi" }, values };
  }
  if (!CODE.test(values.programCode)) {
    return { status: "error", error: "validation", values };
  }

  if (
    (await checkAttempt("doi-import", user.id)) !== "allowed" ||
    (await checkAttempt("doi-import-day", user.id)) !== "allowed"
  ) {
    return { status: "error", error: "rate_limited", values };
  }

  // Fiche déjà importée : la source n'est pas sollicitée une seconde fois.
  const session = await createSessionClient();
  const existing = await session
    .from("resources")
    .select("id")
    .eq("source_name", "crossref")
    .eq("source_identifier", doi)
    .eq("visibility", "public")
    .not("editorial_status", "in", "(rejected,removed)")
    .limit(1);
  const existingId = existing.data?.[0]?.id;
  if (existingId) {
    const locale = await getLocale();
    return redirect({
      href: { pathname: `/moderation/${existingId}`, query: { notice: "already-imported" } },
      locale,
    });
  }

  const result = await fetchCrossrefWork(doi);
  if (!result.ok) {
    const error =
      result.reason === "not_found"
        ? "doi_not_found"
        : result.reason === "unsupported_type"
          ? "unsupported_type"
          : result.reason === "paused"
            ? "source_paused"
            : result.reason === "daily_limit"
              ? "source_daily_limit"
              : "source_unavailable";
    return { status: "error", error, values };
  }
  const { work } = result;

  // La langue annoncée par la source prime si le référentiel la connaît ;
  // sinon, celle qu'indique le modérateur.
  let languageCode: string | null = null;
  if (work.languageCode) {
    const known = await session.from("languages").select("code").eq("code", work.languageCode);
    if ((known.data ?? []).length === 1) languageCode = work.languageCode;
  }
  languageCode ??= /^[a-z]{2,3}$/.test(values.languageCode) ? values.languageCode : null;
  if (!languageCode) return { status: "error", error: "language_required", values };

  const { data, error } = await createServiceClient().rpc("import_connector_resource", {
    actor_id: user.id,
    payload: {
      source_name: "crossref",
      source_identifier: work.doi,
      type_code: work.typeCode,
      title: work.title,
      authors: work.authors,
      publication_year: work.publicationYear === null ? "" : String(work.publicationYear),
      language_code: languageCode,
      program_code: values.programCode,
      doi: work.doi,
      official_url: work.officialUrl,
      license_code: work.licenseCode,
    },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  const outcome = data as { id?: unknown; created?: unknown } | null;
  if (typeof outcome?.id !== "string") return { status: "error", error: "unavailable", values };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/moderation/${outcome.id}`,
      query: { notice: outcome.created === true ? "imported" : "already-imported" },
    },
    locale,
  });
}
