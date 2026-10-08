"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { serverEnv } from "@/lib/env.server";
import { sendOrganizationInvitation } from "@/lib/mail/send";
import { createSessionClient } from "@/lib/supabase/server";
import { inviteOrgMemberSchema, ORG_INVITATION_TOKEN, orgMemberRoleSchema } from "./schemas";

// Vie d'une organisation. Chaque action appelle une fonction nommée de la
// base, sous la session de l'utilisateur : c'est elle qui vérifie qu'il
// administre l'organisation, qu'il en est membre, ou qu'il est la personne
// invitée. Ces fonctions lèvent leurs refus, dont le message est un code.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function backToOrganization(organizationId: string, notice: string): Promise<never> {
  const locale = await getLocale();
  return redirect({ href: { pathname: `/organizations/${organizationId}`, query: { notice } }, locale });
}

export async function inviteOrgMember(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = { email: text(formData, "email").slice(0, 254), role: text(formData, "role").slice(0, 20) };
  const parsed = inviteOrgMemberSchema.safeParse({ organizationId: text(formData, "organizationId"), ...values });
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
  const { data: token, error } = await supabase.rpc("invite_org_member", {
    organization_id: parsed.data.organizationId,
    payload: { email: parsed.data.email, role: parsed.data.role },
  });
  if (error || typeof token !== "string" || !ORG_INVITATION_TOKEN.test(token)) {
    return { status: "error", error: error ? catalogueErrorCode(error) : "unavailable", values };
  }

  // Le jeton n'existe qu'ici et dans le courriel : la base n'en garde que
  // l'empreinte, et il n'est ni affiché ni journalisé.
  const locale = await getLocale();
  const link = `${serverEnv().APP_URL}/${locale}/organizations/invitations/${token}`;
  const sent = await sendOrganizationInvitation(parsed.data.email, link);

  return backToOrganization(parsed.data.organizationId, sent ? "invited" : "invited-not-sent");
}

export async function revokeOrgInvitation(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const organizationId = z.uuid().safeParse(text(formData, "organizationId"));
  const invitationId = z.uuid().safeParse(text(formData, "invitationId"));
  if (!organizationId.success || !invitationId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("revoke_org_invitation", { invitation_id: invitationId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  return backToOrganization(organizationId.data, "revoked");
}

export async function setOrgMemberRole(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const values = { role: text(formData, "role").slice(0, 20) };
  const parsed = orgMemberRoleSchema.safeParse({
    organizationId: text(formData, "organizationId"),
    userId: text(formData, "userId"),
    ...values,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      error: "validation",
      fields: field === "role" ? { role: "invalid_choice" } : undefined,
      values,
    };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_org_member_role", {
    organization_id: parsed.data.organizationId,
    user_id: parsed.data.userId,
    role: parsed.data.role,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  return backToOrganization(parsed.data.organizationId, "role-changed");
}

export async function removeOrgMember(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const organizationId = z.uuid().safeParse(text(formData, "organizationId"));
  const userId = z.uuid().safeParse(text(formData, "userId"));
  if (!organizationId.success || !userId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("remove_org_member", {
    organization_id: organizationId.data,
    user_id: userId.data,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  return backToOrganization(organizationId.data, "removed");
}

/** Accepte l'invitation désignée par le jeton, sous l'adresse confirmée de l'utilisateur. */
export async function acceptOrgInvitation(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const token = text(formData, "token");
  // Jeton inconnu, expiré, révoqué ou destiné à quelqu'un d'autre : même réponse.
  if (!ORG_INVITATION_TOKEN.test(token)) return { status: "error", error: "invalid_link" };

  const supabase = await createSessionClient();
  const { data: organizationId, error } = await supabase.rpc("accept_org_invitation", { token });
  if (error) {
    const code = catalogueErrorCode(error);
    // Ce refus n'est dit qu'à la personne invitée : c'est son propre compte
    // qui doit d'abord activer la validation en deux étapes.
    return { status: "error", error: code === "second_factor_missing" ? "second_factor_setup_required" : code };
  }
  if (typeof organizationId !== "string") return { status: "error", error: "invalid_link" };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/organizations", query: { notice: "joined" } }, locale });
}

export async function leaveOrganization(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  const organizationId = z.uuid().safeParse(text(formData, "organizationId"));
  if (!organizationId.success || text(formData, "confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" } };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("leave_organization", { organization_id: organizationId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/organizations", query: { notice: "left" } }, locale });
}
