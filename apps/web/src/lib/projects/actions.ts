"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";
import {
  newProjectSchema,
  projectFieldErrors,
  projectSchema,
  splitLines,
  toProjectPayload,
} from "./schemas";

// Actions des projets de recherche. Chacune appelle une fonction nommée de la
// base, sous la session de l'utilisateur : c'est la base qui vérifie que le
// projet est le sien.

const expired: AuthFormState = { status: "error", error: "session_expired" };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const FIELDS = [
  "title", "programCode", "status", "dueDate", "supervisorName", "context", "problemStatement",
  "mainQuestion", "secondaryQuestions", "hypotheses", "generalObjective", "specificObjectives",
  "theoreticalFramework", "methodology", "fieldwork", "populationSample", "outline",
] as const;

/** Valeurs à réafficher après une erreur. */
function submittedValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(FIELDS.map((name) => [name, text(formData, name).slice(0, 21000)]));
}

export async function createProject(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = {
    title: text(formData, "title").slice(0, 400),
    programCode: text(formData, "programCode").slice(0, 50),
  };
  const parsed = newProjectSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: projectFieldErrors(parsed.error), values };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("create_project", {
    payload: { title: parsed.data.title, program_code: parsed.data.programCode ?? "" },
  });
  if (error || typeof data !== "string") {
    return { status: "error", error: error ? catalogueErrorCode(error) : "unavailable", values };
  }

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${data}/edit`, query: { notice: "created" } },
    locale,
  });
}

export async function updateProject(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  if (!projectId.success) return { status: "error", error: "validation" };

  const parsed = projectSchema.safeParse({
    title: text(formData, "title"),
    programCode: text(formData, "programCode"),
    status: text(formData, "status"),
    dueDate: text(formData, "dueDate"),
    supervisorName: text(formData, "supervisorName"),
    context: text(formData, "context"),
    problemStatement: text(formData, "problemStatement"),
    mainQuestion: text(formData, "mainQuestion"),
    secondaryQuestions: splitLines(text(formData, "secondaryQuestions")),
    hypotheses: splitLines(text(formData, "hypotheses")),
    generalObjective: text(formData, "generalObjective"),
    specificObjectives: splitLines(text(formData, "specificObjectives")),
    theoreticalFramework: text(formData, "theoreticalFramework"),
    methodology: text(formData, "methodology"),
    fieldwork: text(formData, "fieldwork"),
    populationSample: text(formData, "populationSample"),
    outline: text(formData, "outline"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: projectFieldErrors(parsed.error),
      values: submittedValues(formData),
    };
  }

  const supabase = await createSessionClient();
  // La date de modification lue à l'ouverture du formulaire : si la fiche a
  // changé depuis (autre onglet, autre appareil), la base refuse d'écraser.
  const readAt = z.iso.datetime({ offset: true }).safeParse(text(formData, "updatedAt"));
  const { error } = await supabase.rpc("update_project", {
    project_id: projectId.data,
    payload: {
      ...toProjectPayload(parsed.data),
      ...(readAt.success ? { expected_updated_at: readAt.data } : {}),
    },
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
    href: { pathname: `/projects/${projectId.data}`, query: { notice: "saved" } },
    locale,
  });
}

export async function deleteProject(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  // La confirmation est saisie : une suppression ne se fait pas d'un seul clic.
  if (!projectId.success || text(formData, "confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" } };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("delete_project", { project_id: projectId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/projects", query: { notice: "deleted" } }, locale });
}
