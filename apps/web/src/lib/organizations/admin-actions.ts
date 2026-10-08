"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { serverEnv } from "@/lib/env.server";
import { sendOrganizationInvitation } from "@/lib/mail/send";
import { createSessionClient } from "@/lib/supabase/server";
import {
  createOrganizationSchema,
  dissolveOrganizationSchema,
  inviteOrgAdminSchema,
  ORG_INVITATION_TOKEN,
  ORG_UUID,
  organizationPage,
  organizationStatusSchema,
  producedValue,
  refusalCode,
  renameOrganizationSchema,
  statusNeedsReason,
  succeeded,
} from "./schemas";

// Administration des organisations par la plateforme. Chaque action appelle
// une fonction de la base sous la session de l'administrateur : rôle, second
// facteur récent, interdiction d'agir sur sa propre organisation, règles de
// reprise et journalisation y sont tenus. Ces actions ne font que valider la
// forme des entrées et traduire le résultat.

const expired: AuthFormState = { status: "error", error: "session_expired" };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Retour à la liste, sur la page d'où vient le formulaire. */
async function backToList(formData: FormData, notice: string): Promise<never> {
  const page = organizationPage(text(formData, "page"));
  const locale = await getLocale();
  return redirect({
    href: {
      pathname: "/admin/organizations",
      query: page > 1 ? { notice, page: String(page) } : { notice },
    },
    locale,
  });
}

export async function createOrganization(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = {
    name: text(formData, "name").slice(0, 200),
    slug: text(formData, "slug").slice(0, 80),
    countryCode: text(formData, "countryCode").slice(0, 2),
  };
  const parsed = createOrganizationSchema.safeParse({
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    countryCode: text(formData, "countryCode"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      error: "validation",
      fields:
        field === "name"
          ? { name: "invalid_org_name" }
          : field === "slug"
            ? { slug: "invalid_slug" }
            : { countryCode: "invalid_choice" },
      values,
    };
  }

  const supabase = await createSessionClient();
  const response = await supabase.rpc("admin_create_organization", {
    payload: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      ...(parsed.data.countryCode ? { country_code: parsed.data.countryCode } : {}),
    },
  });
  // La création n'est tenue pour faite que si la base rend son identifiant.
  if (!producedValue(response, "id", ORG_UUID)) {
    return { status: "error", error: refusalCode(response), values };
  }
  return backToList(formData, "created");
}

export async function setOrganizationStatus(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = { reason: text(formData, "reason").slice(0, 600) };
  const parsed = organizationStatusSchema.safeParse({
    organizationId: text(formData, "organizationId"),
    intent: text(formData, "intent"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", error: "validation", values };
  if (statusNeedsReason(parsed.data.intent) && parsed.data.reason.length === 0) {
    return { status: "error", error: "reason_required", fields: { reason: "required" }, values };
  }

  const supabase = await createSessionClient();
  const response = await supabase.rpc("admin_set_organization_status", {
    organization_id: parsed.data.organizationId,
    status: parsed.data.intent === "suspend" ? "suspended" : "verified",
    reason: parsed.data.reason,
  });
  // Un refus de la base porte son code ; elle l'a déjà consigné.
  if (!succeeded(response)) return { status: "error", error: refusalCode(response), values };

  return backToList(
    formData,
    parsed.data.intent === "suspend" ? "suspended" : parsed.data.intent === "restore" ? "restored" : "verified",
  );
}

export async function renameOrganization(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = { name: text(formData, "name").slice(0, 200), slug: text(formData, "slug").slice(0, 80) };
  const parsed = renameOrganizationSchema.safeParse({
    organizationId: text(formData, "organizationId"),
    name: text(formData, "name"),
    slug: text(formData, "slug"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      error: "validation",
      fields: field === "name" ? { name: "invalid_org_name" } : field === "slug" ? { slug: "invalid_slug" } : undefined,
      values,
    };
  }

  const supabase = await createSessionClient();
  const response = await supabase.rpc("admin_rename_organization", {
    organization_id: parsed.data.organizationId,
    payload: { name: parsed.data.name, slug: parsed.data.slug },
  });
  if (!succeeded(response)) return { status: "error", error: refusalCode(response), values };

  return backToList(formData, "renamed");
}

export async function dissolveOrganization(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = { reason: text(formData, "reason").slice(0, 600) };
  const parsed = dissolveOrganizationSchema.safeParse({
    organizationId: text(formData, "organizationId"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", error: "validation", values };
  if (parsed.data.reason.length === 0) {
    return { status: "error", error: "reason_required", fields: { reason: "required" }, values };
  }
  // Irréversible : la case confirme que le geste est voulu.
  if (text(formData, "confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" }, values };
  }

  const supabase = await createSessionClient();
  const response = await supabase.rpc("admin_dissolve_organization", {
    organization_id: parsed.data.organizationId,
    reason: parsed.data.reason,
  });
  if (!succeeded(response)) return { status: "error", error: refusalCode(response), values };

  return backToList(formData, "dissolved");
}

/**
 * Invite le premier administrateur d'une organisation, ou un administrateur de
 * reprise si elle est suspendue : c'est la base qui dit lequel, et qui peut.
 */
export async function inviteOrganizationAdmin(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = { email: text(formData, "email").slice(0, 254) };
  const parsed = inviteOrgAdminSchema.safeParse({
    organizationId: text(formData, "organizationId"),
    email: text(formData, "email"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      error: "validation",
      fields: field === "email" ? { email: "email_invalid" } : undefined,
      values,
    };
  }

  const supabase = await createSessionClient();
  const response = await supabase.rpc("admin_invite_org_admin", {
    organization_id: parsed.data.organizationId,
    email: parsed.data.email,
  });
  const token = producedValue(response, "token", ORG_INVITATION_TOKEN);
  if (!token) {
    const code = refusalCode(response);
    // Des membres, plus d'administrateur, organisation active : la base exige
    // d'abord une suspension. Le message le dit plutôt qu'un refus générique.
    return {
      status: "error",
      error: code === "invalid_transition" ? "org_suspension_required" : code,
      values,
    };
  }

  // Le jeton n'existe qu'ici et dans le courriel : la base n'en garde que
  // l'empreinte, et il n'est ni affiché ni journalisé.
  const locale = await getLocale();
  const link = `${serverEnv().APP_URL}/${locale}/organizations/invitations/${token}`;
  const sent = await sendOrganizationInvitation(parsed.data.email, link);

  return backToList(formData, sent ? "admin-invited" : "admin-invited-not-sent");
}
