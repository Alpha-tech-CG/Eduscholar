"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { serverEnv } from "@/lib/env.server";
import { sendProjectInvitation } from "@/lib/mail/send";
import { createSessionClient } from "@/lib/supabase/server";
import { INVITATION_TOKEN, MEMBER_ROLES } from "./sharing-queries";

// Partage d'un projet. Chaque action appelle une fonction nommée de la base,
// sous la session de l'utilisateur : c'est elle qui vérifie qu'il est le
// propriétaire du projet, ou la personne invitée.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const inviteSchema = z.object({
  projectId: z.uuid(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(MEMBER_ROLES),
});

export async function inviteMember(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return expired;

  const values = { email: text(formData, "email").slice(0, 254), role: text(formData, "role").slice(0, 20) };
  const parsed = inviteSchema.safeParse({ projectId: text(formData, "projectId"), ...values });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      error: "validation",
      fields:
        field === "email" ? { email: "email_invalid" } : field === "role" ? { role: "invalid_choice" } : undefined,
      values,
    };
  }

  const supabase = await createSessionClient();
  const { data: token, error } = await supabase.rpc("invite_project_member", {
    project_id: parsed.data.projectId,
    payload: { email: parsed.data.email, role: parsed.data.role },
  });
  if (error || typeof token !== "string") {
    return { status: "error", error: error ? catalogueErrorCode(error) : "unavailable", values };
  }

  // Le jeton n'existe qu'ici et dans le courriel : la base n'en garde que
  // l'empreinte, et il n'est ni affiché ni journalisé.
  const locale = await getLocale();
  const link = `${serverEnv().APP_URL}/${locale}/invitations/${token}`;
  const sent = await sendProjectInvitation(parsed.data.email, link, user.email ?? null);

  return redirect({
    href: {
      pathname: `/projects/${parsed.data.projectId}/sharing`,
      query: { notice: sent ? "invited" : "invited-not-sent" },
    },
    locale,
  });
}

export async function revokeInvitation(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  const invitationId = z.uuid().safeParse(text(formData, "invitationId"));
  if (!projectId.success || !invitationId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("revoke_project_invitation", { invitation_id: invitationId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${projectId.data}/sharing`, query: { notice: "revoked" } },
    locale,
  });
}

export async function removeMember(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  const userId = z.uuid().safeParse(text(formData, "userId"));
  if (!projectId.success || !userId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("remove_project_member", {
    project_id: projectId.data,
    user_id: userId.data,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/projects/${projectId.data}/sharing`, query: { notice: "removed" } },
    locale,
  });
}

/** Accepte l'invitation désignée par le jeton, sous l'adresse confirmée de l'utilisateur. */
export async function acceptInvitation(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const token = text(formData, "token");
  // Jeton inconnu, expiré, révoqué ou destiné à quelqu'un d'autre : même réponse.
  if (!INVITATION_TOKEN.test(token)) return { status: "error", error: "invalid_link" };

  const supabase = await createSessionClient();
  const { data: projectId, error } = await supabase.rpc("accept_project_invitation", { token });
  if (error) return { status: "error", error: catalogueErrorCode(error) };
  if (typeof projectId !== "string") return { status: "error", error: "invalid_link" };

  const locale = await getLocale();
  return redirect({ href: { pathname: `/shared/${projectId}`, query: { notice: "joined" } }, locale });
}

export async function leaveProject(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const projectId = z.uuid().safeParse(text(formData, "projectId"));
  if (!projectId.success || text(formData, "confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" } };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("leave_project", { project_id: projectId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/shared", query: { notice: "left" } }, locale });
}
