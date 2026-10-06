"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { createSessionClient } from "@/lib/supabase/server";
import { catalogueErrorCode } from "./errors";
import {
  ACTIONS_REQUIRING_REASON,
  moderationSchema,
  moderatorEditSchema,
  reportResolutionSchema,
  resourceFieldErrors,
  resourceSchema,
  splitList,
  toResourcePayload,
} from "./schemas";

// Actions du catalogue. Chacune appelle une fonction nommée de la base, sous la
// session de l'utilisateur : c'est la base qui vérifie le droit, applique la
// règle et écrit l'historique (ADR-0007). Ces actions valident la forme des
// entrées et traduisent le résultat.

const expired: AuthFormState = { status: "error", error: "session_expired" };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function list(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
}

function parseResource(formData: FormData) {
  return resourceSchema.safeParse({
    typeCode: text(formData, "typeCode"),
    title: text(formData, "title"),
    abstract: text(formData, "abstract"),
    authors: splitList(text(formData, "authors"), /\r?\n|;/),
    institutionName: text(formData, "institutionName"),
    publicationYear: text(formData, "publicationYear"),
    thesisDegree: text(formData, "thesisDegree"),
    languageCode: text(formData, "languageCode"),
    countryCode: text(formData, "countryCode"),
    programCode: text(formData, "programCode"),
    levelCodes: list(formData, "levelCodes"),
    subjectCodes: list(formData, "subjectCodes"),
    tags: splitList(text(formData, "tags").toLowerCase(), /,|\r?\n/),
    doi: text(formData, "doi"),
    officialUrl: text(formData, "officialUrl"),
    accessStatus: text(formData, "accessStatus"),
    licenseCode: text(formData, "licenseCode"),
    contributorComment: text(formData, "contributorComment"),
    permissionProof: text(formData, "permissionProof"),
    rightsDeclared: text(formData, "rightsDeclared") === "on",
  });
}

/** Valeurs à réafficher après une erreur : tout sauf les cases à cocher. */
function submittedValues(formData: FormData): Record<string, string> {
  const names = [
    "typeCode", "title", "abstract", "authors", "institutionName", "publicationYear",
    "thesisDegree", "languageCode", "countryCode", "programCode", "tags", "doi",
    "officialUrl", "accessStatus", "licenseCode", "contributorComment", "permissionProof",
  ];
  return Object.fromEntries(names.map((name) => [name, text(formData, name).slice(0, 5000)]));
}

export async function submitResource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = parseResource(formData);
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: resourceFieldErrors(parsed.error),
      values: submittedValues(formData),
    };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("submit_resource", {
    payload: toResourcePayload(parsed.data),
  });
  if (error) {
    return {
      status: "error",
      error: catalogueErrorCode(error),
      values: submittedValues(formData),
    };
  }

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/contributions", query: { notice: "submitted" } },
    locale,
  });
}

export async function updateSubmission(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const resourceId = text(formData, "resourceId");
  const parsed = parseResource(formData);
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: resourceFieldErrors(parsed.error),
      values: submittedValues(formData),
    };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("update_submission", {
    resource_id: resourceId,
    payload: toResourcePayload(parsed.data),
  });
  if (error) {
    return {
      status: "error",
      error: catalogueErrorCode(error),
      values: submittedValues(formData),
    };
  }

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/contributions", query: { notice: "updated" } },
    locale,
  });
}

export async function withdrawSubmission(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("withdraw_submission", {
    resource_id: text(formData, "resourceId"),
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/contributions", query: { notice: "withdrawn" } },
    locale,
  });
}

export async function moderateResource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = moderationSchema.safeParse({
    resourceId: text(formData, "resourceId"),
    action: text(formData, "action"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", error: "validation" };
  if (ACTIONS_REQUIRING_REASON.has(parsed.data.action) && !parsed.data.reason) {
    return { status: "error", error: "reason_required" };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("moderate_resource", {
    resource_id: parsed.data.resourceId,
    action: parsed.data.action,
    reason: parsed.data.reason,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/moderation/${parsed.data.resourceId}`,
      query: { notice: parsed.data.action },
    },
    locale,
  });
}

export async function moderatorUpdateResource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = moderatorEditSchema.safeParse({
    resourceId: text(formData, "resourceId"),
    officialUrl: text(formData, "officialUrl"),
    accessStatus: text(formData, "accessStatus"),
    licenseCode: text(formData, "licenseCode"),
    moderationNotes: text(formData, "moderationNotes"),
  });
  if (!parsed.success) return { status: "error", error: "validation" };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("moderator_update_resource", {
    resource_id: parsed.data.resourceId,
    payload: {
      official_url: parsed.data.officialUrl,
      access_status: parsed.data.accessStatus,
      license_code: parsed.data.licenseCode,
      moderation_notes: parsed.data.moderationNotes ?? "",
    },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/moderation/${parsed.data.resourceId}`, query: { notice: "edited" } },
    locale,
  });
}

export async function resolveReport(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = reportResolutionSchema.safeParse({
    reportId: text(formData, "reportId"),
    status: text(formData, "status"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return { status: "error", error: "validation" };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("resolve_report", {
    report_id: parsed.data.reportId,
    status: parsed.data.status,
    note: parsed.data.note,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/moderation", query: { notice: "report-handled" } },
    locale,
  });
}
