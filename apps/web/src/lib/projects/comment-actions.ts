"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";

// Commentaires d'un projet partagé. Chaque action appelle une fonction nommée
// de la base, qui vérifie la place de l'utilisateur dans le projet.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

// La page d'où vient le formulaire : celle du propriétaire ou celle d'un membre.
// Elle est reconstruite à partir d'identifiants validés, jamais d'une adresse reçue.
const origin = z.object({
  scope: z.enum(["owner", "member"]),
  projectId: z.uuid(),
  sectionId: z.uuid(),
});

function backTo(target: z.infer<typeof origin>, notice: string) {
  return {
    pathname:
      target.scope === "owner"
        ? `/projects/${target.projectId}/outline/${target.sectionId}`
        : `/shared/${target.projectId}/sections/${target.sectionId}`,
    query: { notice },
  };
}

function readOrigin(formData: FormData) {
  const parsed = origin.safeParse({
    scope: text(formData, "scope"),
    projectId: text(formData, "projectId"),
    sectionId: text(formData, "sectionId"),
  });
  return parsed.success ? parsed.data : null;
}

export async function addComment(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const target = readOrigin(formData);
  if (!target) return invalid;

  const body = text(formData, "body").replace(/\r\n?/g, "\n");
  const quote = text(formData, "quote").trim();
  const parentId = text(formData, "parentId");
  const values = { body: body.slice(0, 2400), quote: quote.slice(0, 480) };
  if (body.trim().length === 0) {
    return { status: "error", error: "validation", fields: { body: "required" }, values };
  }
  if (body.trim().length > 2000) {
    return { status: "error", error: "validation", fields: { body: "too_long" }, values };
  }
  if (quote.length > 400) {
    return { status: "error", error: "validation", fields: { quote: "too_long" }, values };
  }
  if (parentId && !z.uuid().safeParse(parentId).success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("add_project_comment", {
    section_id: target.sectionId,
    payload: {
      body,
      ...(quote && !parentId ? { quote } : {}),
      ...(parentId ? { parent_id: parentId } : {}),
    },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  const locale = await getLocale();
  return redirect({ href: backTo(target, parentId ? "replied" : "commented"), locale });
}

export async function deleteComment(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const target = readOrigin(formData);
  const commentId = z.uuid().safeParse(text(formData, "commentId"));
  if (!target || !commentId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("delete_project_comment", { comment_id: commentId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: backTo(target, "comment-deleted"), locale });
}

export async function resolveThread(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const target = readOrigin(formData);
  const commentId = z.uuid().safeParse(text(formData, "commentId"));
  const resolved = z.enum(["true", "false"]).safeParse(text(formData, "resolved"));
  if (!target || !commentId.success || !resolved.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("resolve_project_thread", {
    comment_id: commentId.data,
    resolved: resolved.data === "true",
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: backTo(target, resolved.data === "true" ? "resolved" : "reopened"), locale });
}
