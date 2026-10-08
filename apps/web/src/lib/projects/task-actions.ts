"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";

// Tâches d'un projet partagé. Chaque action appelle une fonction nommée de la
// base : elle décide de qui peut créer, modifier ou clore.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

// La page d'où vient le formulaire, reconstruite à partir d'identifiants validés.
const origin = z.object({ scope: z.enum(["owner", "member"]), projectId: z.uuid() });

function readOrigin(formData: FormData) {
  const parsed = origin.safeParse({ scope: text(formData, "scope"), projectId: text(formData, "projectId") });
  return parsed.success ? parsed.data : null;
}

const backTo = (target: z.infer<typeof origin>, notice: string) => ({
  pathname: `${target.scope === "owner" ? "/projects" : "/shared"}/${target.projectId}/tasks`,
  query: { notice },
});

export async function addTask(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const target = readOrigin(formData);
  if (!target) return invalid;

  const title = text(formData, "title").trim();
  const details = text(formData, "details").replace(/\r\n?/g, "\n").trim();
  const dueDate = text(formData, "dueDate").trim();
  const values = { title: title.slice(0, 240), details: details.slice(0, 1200), dueDate: dueDate.slice(0, 10) };
  if (title.length === 0) {
    return { status: "error", error: "validation", fields: { title: "required" }, values };
  }
  if (title.length > 200) {
    return { status: "error", error: "validation", fields: { title: "too_long" }, values };
  }
  if (details.length > 1000) {
    return { status: "error", error: "validation", fields: { details: "too_long" }, values };
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return { status: "error", error: "validation", fields: { dueDate: "invalid_date" }, values };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("add_project_task", {
    project_id: target.projectId,
    payload: { title, ...(details ? { details } : {}), ...(dueDate ? { due_date: dueDate } : {}) },
  });
  if (error) {
    const code = catalogueErrorCode(error);
    return {
      status: "error",
      error: code,
      fields: error.message === "invalid_date" ? { dueDate: "invalid_date" } : undefined,
      values,
    };
  }

  const locale = await getLocale();
  return redirect({ href: backTo(target, "task-added"), locale });
}

/** Clôt ou rouvre une tâche. */
export async function toggleTask(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const target = readOrigin(formData);
  const taskId = z.uuid().safeParse(text(formData, "taskId"));
  const done = z.enum(["true", "false"]).safeParse(text(formData, "done"));
  if (!target || !taskId.success || !done.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("update_project_task", {
    task_id: taskId.data,
    payload: { done: done.data === "true" },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: backTo(target, done.data === "true" ? "task-done" : "task-reopened"), locale });
}

export async function deleteTask(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const target = readOrigin(formData);
  const taskId = z.uuid().safeParse(text(formData, "taskId"));
  if (!target || !taskId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("delete_project_task", { task_id: taskId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: backTo(target, "task-deleted"), locale });
}
