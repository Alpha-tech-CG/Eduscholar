"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";
import { DECISIONS } from "./version-queries";

// Versions soumises. Chaque action appelle une fonction nommée de la base :
// seul le propriétaire soumet, seul l'encadreur décide.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function submitVersion(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  if (!projectId.success) return invalid;

  const label = text(formData, "label").trim();
  const note = text(formData, "note").replace(/\r\n?/g, "\n").trim();
  const values = { label: label.slice(0, 150), note: note.slice(0, 1200) };
  if (label.length > 120) {
    return { status: "error", error: "validation", fields: { label: "too_long" }, values };
  }
  if (note.length > 1000) {
    return { status: "error", error: "validation", fields: { note: "too_long" }, values };
  }
  if (text(formData, "confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" }, values };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("submit_thesis_version", {
    project_id: projectId.data,
    payload: { ...(label ? { label } : {}), ...(note ? { note } : {}) },
  });
  if (error || typeof data !== "string") {
    return { status: "error", error: error ? catalogueErrorCode(error) : "unavailable", values };
  }

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${projectId.data}/versions`, query: { notice: "submitted" } },
    locale,
  });
}

/** Décision de l'encadreur sur une version soumise. */
export async function decideVersion(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  const versionId = z.uuid().safeParse(text(formData, "versionId"));
  if (!projectId.success || !versionId.success) return invalid;

  const comment = text(formData, "comment").replace(/\r\n?/g, "\n").trim();
  const values = { decision: text(formData, "decision").slice(0, 30), comment: comment.slice(0, 2400) };
  const decision = z.enum(DECISIONS).safeParse(values.decision);
  if (!decision.success) {
    return { status: "error", error: "validation", fields: { decision: "invalid_choice" }, values };
  }
  if (comment.length > 2000) {
    return { status: "error", error: "validation", fields: { comment: "too_long" }, values };
  }
  if (decision.data !== "accepted" && comment.length === 0) {
    return { status: "error", error: "reason_required", fields: { comment: "required" }, values };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("decide_thesis_version", {
    version_id: versionId.data,
    payload: { decision: decision.data, ...(comment ? { comment } : {}) },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/shared/${projectId.data}/versions/${versionId.data}`,
      query: { notice: "decided" },
    },
    locale,
  });
}

/**
 * Efface le contenu d'une version soumise par erreur. La trace de la
 * soumission et les décisions rendues restent ; le document part.
 */
export async function eraseVersion(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  const versionId = z.uuid().safeParse(text(formData, "versionId"));
  if (!projectId.success || !versionId.success) return invalid;
  if (text(formData, "confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" } };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("erase_thesis_version", { version_id: versionId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${projectId.data}/versions/${versionId.data}`,
      query: { notice: "erased" },
    },
    locale,
  });
}
