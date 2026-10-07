"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthErrorCode, AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";
import { citationSchema, countWords, newSectionSchema, sectionSchema } from "./section-schemas";
import { sourceFieldErrors, type SourceFieldErrorCode } from "./source-schemas";

// Actions du plan du mémoire. Chacune appelle une fonction nommée de la base,
// sous la session de l'utilisateur : la base vérifie que la section est la
// sienne avant d'examiner la requête.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

function reader(formData: FormData) {
  return (name: string): string => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
}

function ids(get: (name: string) => string) {
  const projectId = z.uuid().safeParse(get("projectId"));
  const sectionId = z.uuid().safeParse(get("sectionId"));
  return projectId.success && sectionId.success
    ? { projectId: projectId.data, sectionId: sectionId.data }
    : null;
}

export async function addSection(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const projectId = z.uuid().safeParse(get("projectId"));
  if (!projectId.success) return invalid;
  const values = { title: get("title").slice(0, 400), level: get("level").slice(0, 2) };
  const parsed = newSectionSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: sourceFieldErrors(parsed.error), values };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("add_thesis_section", {
    project_id: projectId.data,
    payload: parsed.data,
  });
  if (error || typeof data !== "string") {
    return { status: "error", error: error ? catalogueErrorCode(error) : "unavailable", values };
  }

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${projectId.data}/outline/${data}`, query: { notice: "added" } },
    locale,
  });
}

export async function updateSection(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const target = ids(get);
  if (!target) return invalid;
  // Le texte saisi est toujours rendu à l'utilisateur en cas d'erreur : il ne
  // doit jamais perdre ce qu'il vient d'écrire.
  // Un formulaire envoie les sauts de ligne en « \r\n » : ils sont ramenés à
  // « \n », pour que la longueur comptée soit celle que l'utilisateur voit.
  const body = get("body").replace(/\r\n?/g, "\n");
  const values = {
    title: get("title").slice(0, 400),
    level: get("level").slice(0, 2),
    body: body.slice(0, 40000),
  };
  const parsed = sectionSchema.safeParse({ ...values, body });
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: sourceFieldErrors(parsed.error), values };
  }

  // La date de modification lue à l'ouverture : si la section a changé depuis
  // (autre onglet, autre appareil), la base refuse d'écraser.
  // Sans cette date, l'enregistrement est refusé plutôt que fait sans contrôle.
  const readAt = z.iso.datetime({ offset: true }).safeParse(get("updatedAt"));
  if (!readAt.success) return { status: "error", error: "conflict", values };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("update_thesis_section", {
    section_id: target.sectionId,
    payload: {
      title: parsed.data.title,
      level: parsed.data.level,
      body: parsed.data.body ?? "",
      expected_updated_at: readAt.data,
    },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${target.projectId}/outline/${target.sectionId}`,
      query: { notice: "saved" },
    },
    locale,
  });
}

export type SectionSaveResult =
  | { status: "saved"; updatedAt: string; words: number }
  | { status: "error"; error: AuthErrorCode; fields?: Record<string, SourceFieldErrorCode> };

const draftSchema = z.object({
  projectId: z.uuid(),
  sectionId: z.uuid(),
  title: z.string().max(400),
  level: z.string().max(2),
  body: z.string().max(40000),
  updatedAt: z.iso.datetime({ offset: true }),
});

/**
 * Enregistre la section sans quitter la page : enregistrement automatique, ou
 * bouton d'enregistrement quand le script de la page est chargé. Mêmes règles
 * que `updateSection` ; la réponse porte la nouvelle date de version, que
 * l'éditeur présente à l'enregistrement suivant.
 */
export async function saveSectionDraft(input: unknown): Promise<SectionSaveResult> {
  if (!(await getFullySignedInUser())) return { status: "error", error: "session_expired" };

  const draft = draftSchema.safeParse(input);
  if (!draft.success) return { status: "error", error: "validation" };
  const body = draft.data.body.replace(/\r\n?/g, "\n");
  const parsed = sectionSchema.safeParse({ title: draft.data.title, level: draft.data.level, body });
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: sourceFieldErrors(parsed.error) };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("update_thesis_section", {
    section_id: draft.data.sectionId,
    payload: {
      title: parsed.data.title,
      level: parsed.data.level,
      body: parsed.data.body ?? "",
      expected_updated_at: draft.data.updatedAt,
    },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };
  if (typeof data !== "string") return { status: "error", error: "unavailable" };

  return { status: "saved", updatedAt: data, words: countWords(parsed.data.body ?? null) };
}

export type SectionVersion = { title: string; level: string; body: string; updatedAt: string };
export type SectionVersionResult =
  | { status: "found"; version: SectionVersion }
  | { status: "gone" }
  | { status: "error"; error: "session_expired" | "unavailable" };

/**
 * La version enregistrée d'une section, pour sortir d'un conflit sans recharger
 * la page. « gone » : la section n'existe plus, ou n'est pas celle de
 * l'utilisateur — même réponse. Une lecture qui échoue n'est jamais présentée
 * comme une suppression.
 */
export async function loadSectionVersion(input: unknown): Promise<SectionVersionResult> {
  if (!(await getFullySignedInUser())) return { status: "error", error: "session_expired" };
  const target = z.object({ projectId: z.uuid(), sectionId: z.uuid() }).safeParse(input);
  if (!target.success) return { status: "gone" };

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("thesis_sections")
    .select("title, level, body, updated_at")
    .eq("id", target.data.sectionId)
    .eq("project_id", target.data.projectId)
    .maybeSingle();
  if (error) return { status: "error", error: "unavailable" };
  if (!data) return { status: "gone" };
  return {
    status: "found",
    version: {
      title: data.title,
      level: String(data.level),
      body: data.body ?? "",
      updatedAt: data.updated_at,
    },
  };
}

export async function moveSection(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const target = ids(get);
  const direction = z.enum(["up", "down"]).safeParse(get("direction"));
  if (!target || !direction.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("move_thesis_section", {
    section_id: target.sectionId,
    direction: direction.data,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${target.projectId}/outline`, query: { notice: "moved" } },
    locale,
  });
}

export async function deleteSection(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const target = ids(get);
  if (!target || get("confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" } };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("delete_thesis_section", { section_id: target.sectionId });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${target.projectId}/outline`, query: { notice: "deleted" } },
    locale,
  });
}

/** Cite une source du projet dans la section, ou met ses pages à jour. */
export async function citeSource(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const target = ids(get);
  if (!target) return invalid;
  const values = { pages: get("pages").slice(0, 80) };
  const parsed = citationSchema.safeParse({ sourceId: get("sourceId"), pages: get("pages") });
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: sourceFieldErrors(parsed.error), values };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_section_citation", {
    section_id: target.sectionId,
    source_id: parsed.data.sourceId,
    present: true,
    pages: parsed.data.pages ?? "",
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${target.projectId}/outline/${target.sectionId}`,
      query: { notice: "cited" },
    },
    locale,
  });
}

export async function removeCitation(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const get = reader(formData);

  const target = ids(get);
  const sourceId = z.uuid().safeParse(get("sourceId"));
  if (!target || !sourceId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_section_citation", {
    section_id: target.sectionId,
    source_id: sourceId.data,
    present: false,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: `/projects/${target.projectId}/outline/${target.sectionId}`,
      query: { notice: "citation-removed" },
    },
    locale,
  });
}
