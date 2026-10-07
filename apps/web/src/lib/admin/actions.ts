"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { afterRefusedCode, isCodeRefusedByHook } from "@/lib/auth/refused-code";
import { codeWaitSeconds } from "@/lib/auth/second-factor";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthErrorCode, AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { sendAccountNotice } from "@/lib/mail/send";
import { createServiceClient, createSessionClient } from "@/lib/supabase/server";

// Actions d'administration. Chacune appelle une fonction de la base sous la
// session de l'administrateur : rôle, second facteur récent, interdiction
// d'agir sur soi et journalisation y sont tenus. Ces actions ne font que
// valider la forme des entrées et traduire le résultat.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Présente à nouveau le second facteur : les opérations d'administration
 * exigent qu'il l'ait été dans les dix dernières minutes.
 */
export async function confirmAdminIdentity(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return expired;

  const code = text(formData, "code").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { status: "error", error: "invalid_code" };
  if ((await codeWaitSeconds()) > 0) return { status: "error", error: "code_wait" };
  if ((await checkAttempt("second-factor", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited" };
  }

  const supabase = await createSessionClient();
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp.find(({ status }) => status === "verified");
  if (!factor) return expired;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    return isCodeRefusedByHook(error) ? afterRefusedCode() : { status: "error", error: "invalid_code" };
  }

  const locale = await getLocale();
  return redirect({ href: { pathname: "/admin", query: { notice: "confirmed" } }, locale });
}

export type FoundUser = {
  userId: string;
  email: string;
  createdAt: string;
  confirmed: boolean;
  roles: string[];
  suspended: boolean;
  suspensionReason: string | null;
  hasSecondFactor: boolean;
};

export type LookupState =
  | { status: "idle" }
  | { status: "error"; error: AuthErrorCode; email: string }
  | { status: "found"; user: FoundUser };

/**
 * Cherche un compte par son adresse exacte. L'adresse voyage dans le corps de
 * la requête, jamais dans l'adresse de la page, et la base journalise la
 * recherche sans l'adresse.
 */
export async function findUser(_previous: LookupState, formData: FormData): Promise<LookupState> {
  const email = text(formData, "email").trim().slice(0, 320);
  const user = await getFullySignedInUser();
  if (!user) return { status: "error", error: "session_expired", email };

  if (!z.email().safeParse(email).success) return { status: "error", error: "validation", email };
  if ((await checkAttempt("admin-lookup", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited", email };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("admin_find_user", { email });
  if (error) return { status: "error", error: catalogueErrorCode(error), email };
  const row = data?.[0];
  if (!row) return { status: "error", error: "user_not_found", email };

  return {
    status: "found",
    user: {
      userId: row.user_id,
      email: row.email,
      createdAt: row.created_at,
      confirmed: row.confirmed,
      roles: row.roles,
      suspended: row.suspended,
      suspensionReason: row.suspension_reason,
      hasSecondFactor: row.has_second_factor,
    },
  };
}

const roleSchema = z.object({
  targetUser: z.uuid(),
  role: z.enum(["moderator", "platform_admin"]),
  grant: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function setRole(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = roleSchema.safeParse({
    targetUser: text(formData, "targetUser"),
    role: text(formData, "role"),
    grant: text(formData, "grant"),
  });
  if (!parsed.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("admin_set_role", {
    target_user: parsed.data.targetUser,
    role: parsed.data.role,
    grant_role: parsed.data.grant,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: "/admin",
      query: { notice: parsed.data.grant ? "role-granted" : "role-revoked" },
    },
    locale,
  });
}

const statusSchema = z.object({
  targetUser: z.uuid(),
  suspended: z.enum(["true", "false"]).transform((value) => value === "true"),
  reason: z.string().trim().max(500),
});

export async function setAccountStatus(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = { reason: text(formData, "reason").slice(0, 600) };
  const parsed = statusSchema.safeParse({
    targetUser: text(formData, "targetUser"),
    suspended: text(formData, "suspended"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", error: "validation", values };
  if (parsed.data.suspended && parsed.data.reason.length === 0) {
    return { status: "error", error: "reason_required", fields: { reason: "required" }, values };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("admin_set_account_status", {
    target_user: parsed.data.targetUser,
    suspended: parsed.data.suspended,
    reason: parsed.data.reason,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  // La base a fait le reste dans la même transaction : sessions du compte
  // fermées, et plus aucune session ouvrable tant qu'il est suspendu.
  //
  // Le titulaire est prévenu par courriel : la connexion, elle, ne lui dira
  // rien. Son adresse est lue par le rôle serveur, une fois l'opération
  // acceptée par la base ; elle n'est ni affichée ni journalisée.
  try {
    const target = await createServiceClient().auth.admin.getUserById(parsed.data.targetUser);
    // Seulement à une adresse confirmée : une adresse saisie par un tiers à
    // l'inscription ne reçoit rien.
    if (target.data.user?.email_confirmed_at) {
      await sendAccountNotice(
        target.data.user.email,
        parsed.data.suspended ? "account_suspended" : "account_restored",
      );
    }
  } catch {
    // L'avis est un complément : la suspension est faite.
  }

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: "/admin",
      query: { notice: parsed.data.suspended ? "suspended" : "restored" },
    },
    locale,
  });
}
