"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";
import {
  NOTE_FIELDS,
  noteSchema,
  readSourceForm,
  sourceFieldErrors,
  sourceSchema,
  toNotePayload,
  toSourcePayload,
} from "./source-schemas";

// Actions sur les sources d'un projet et leurs fiches de lecture. Chacune
// appelle une fonction nommée de la base, sous la session de l'utilisateur :
// la base vérifie que le projet est le sien avant d'examiner la requête.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

const SOURCE_FIELDS = [
  "sourceType", "title", "authors", "publicationYear", "containerTitle", "publisher", "volume",
  "issue", "pages", "doi", "url", "accessedOn",
] as const;

function reader(formData: FormData) {
  return (name: string): string => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
}

function values(formData: FormData, names: readonly string[]): Record<string, string> {
  const get = reader(formData);
  return Object.fromEntries(names.map((name) => [name, get(name).slice(0, 11000)]));
}

export async function addSource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const projectId = z.uuid().safeParse(get("projectId"));
  if (!projectId.success) return invalid;
  const parsed = sourceSchema.safeParse(readSourceForm(get));
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: sourceFieldErrors(parsed.error),
      values: values(formData, SOURCE_FIELDS),
    };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("add_project_source", {
    project_id: projectId.data,
    payload: toSourcePayload(parsed.data),
  });
  if (error || typeof data !== "string") {
    return {
      status: "error",
      error: error ? catalogueErrorCode(error) : "unavailable",
      values: values(formData, SOURCE_FIELDS),
    };
  }

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${projectId.data}/sources/${data}`,
      query: { notice: "added" },
    },
    locale,
  });
}

/** Reprend une fiche publiée du catalogue comme source d'un projet. */
export async function addSourceFromResource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const projectId = z.uuid().safeParse(get("projectId"));
  const resourceId = z.uuid().safeParse(get("resourceId"));
  if (!projectId.success || !resourceId.success) {
    return { status: "error", error: "validation", fields: { projectId: "required" } };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("add_project_source_from_resource", {
    project_id: projectId.data,
    resource_id: resourceId.data,
  });
  if (error || typeof data !== "string") {
    return { status: "error", error: error ? catalogueErrorCode(error) : "unavailable" };
  }

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${projectId.data}/sources/${data}`,
      query: { notice: "added" },
    },
    locale,
  });
}

export async function updateSource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const projectId = z.uuid().safeParse(get("projectId"));
  const sourceId = z.uuid().safeParse(get("sourceId"));
  if (!projectId.success || !sourceId.success) return invalid;
  const parsed = sourceSchema.safeParse(readSourceForm(get));
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: sourceFieldErrors(parsed.error),
      values: values(formData, SOURCE_FIELDS),
    };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("update_project_source", {
    source_id: sourceId.data,
    payload: toSourcePayload(parsed.data),
  });
  if (error) {
    return {
      status: "error",
      error: catalogueErrorCode(error),
      values: values(formData, SOURCE_FIELDS),
    };
  }

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${projectId.data}/sources/${sourceId.data}`,
      query: { notice: "saved" },
    },
    locale,
  });
}

export async function saveNote(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const projectId = z.uuid().safeParse(get("projectId"));
  const sourceId = z.uuid().safeParse(get("sourceId"));
  if (!projectId.success || !sourceId.success) return invalid;
  const parsed = noteSchema.safeParse(Object.fromEntries(NOTE_FIELDS.map((name) => [name, get(name)])));
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: sourceFieldErrors(parsed.error),
      values: values(formData, NOTE_FIELDS),
    };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("save_literature_note", {
    source_id: sourceId.data,
    payload: toNotePayload(parsed.data),
  });
  if (error) {
    return { status: "error", error: catalogueErrorCode(error), values: values(formData, NOTE_FIELDS) };
  }

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${projectId.data}/sources/${sourceId.data}`,
      query: { notice: "note-saved" },
    },
    locale,
  });
}

export async function deleteSource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const projectId = z.uuid().safeParse(get("projectId"));
  const sourceId = z.uuid().safeParse(get("sourceId"));
  if (!projectId.success || !sourceId.success || get("confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" } };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("delete_project_source", { source_id: sourceId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${projectId.data}/sources`, query: { notice: "deleted" } },
    locale,
  });
}
