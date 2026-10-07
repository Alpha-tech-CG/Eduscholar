"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createServiceClient, createSessionClient, verifyPassword } from "@/lib/supabase/server";
import { checkAttempt } from "./rate-limit";
import { afterRefusedCode, isCodeRefusedByHook } from "./refused-code";
import { sendAccountNotice } from "@/lib/mail/send";
import { codeWaitSeconds } from "./second-factor";
import { getCurrentUser, getFullySignedInUser } from "./session";
import type { AuthErrorCode, AuthFormState } from "./state";

// Codes de secours de la validation en deux étapes. Les règles sont en base :
// empreintes seulement, second facteur récent pour générer, essais bornés pour
// utiliser. Ces actions conduisent le parcours.

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export type RecoveryCodesFormState =
  | { status: "idle" }
  | { status: "error"; error: AuthErrorCode }
  /** Les codes ne sont remis qu'ici, une seule fois. */
  | { status: "generated"; codes: string[] };

/**
 * Génère dix nouveaux codes de secours. Si le second facteur n'a pas été
 * présenté récemment, un code de l'application d'authentification est demandé.
 */
export async function generateRecoveryCodes(
  _previous: RecoveryCodesFormState,
  formData: FormData,
): Promise<RecoveryCodesFormState> {
  const user = await getFullySignedInUser();
  if (!user?.email) return { status: "error", error: "session_expired" };

  // Le mot de passe est redemandé, comme à l'activation : une session laissée
  // ouverte ne suffit pas à obtenir des codes durables.
  const password = text(formData, "password");
  if (password.length === 0 || password.length > 1024) {
    return { status: "error", error: "invalid_credentials" };
  }
  if ((await checkAttempt("reauthentication", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited" };
  }
  if (!(await verifyPassword(user.email, password))) {
    return { status: "error", error: "invalid_credentials" };
  }

  const supabase = await createSessionClient();
  const code = text(formData, "code").replace(/\s+/g, "");
  if (code.length > 0) {
    if (!/^\d{6}$/.test(code)) return { status: "error", error: "invalid_code" };
    if ((await codeWaitSeconds()) > 0) return { status: "error", error: "code_wait" };
    if ((await checkAttempt("second-factor", user.id)) !== "allowed") {
      return { status: "error", error: "rate_limited" };
    }
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp.find(({ status }) => status === "verified");
    if (!factor) return { status: "error", error: "session_expired" };
    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (verified.error) {
      return isCodeRefusedByHook(verified.error)
        ? afterRefusedCode()
        : { status: "error", error: "invalid_code" };
    }
  }

  // Après une vérification, le jeton a changé : un client neuf le relit.
  const fresh = code.length > 0 ? await createSessionClient() : supabase;
  const { data, error } = await fresh.rpc("generate_recovery_codes");
  if (error) {
    return {
      status: "error",
      error:
        error.message === "recent_second_factor_required"
          ? "recent_second_factor_required"
          : error.message === "forbidden"
            ? "forbidden"
            : "unavailable",
    };
  }
  const codes = (data ?? []) as string[];
  if (codes.length !== 10) return { status: "error", error: "unavailable" };
  // Le titulaire est prévenu : des codes générés à son insu ouvriraient son compte.
  await sendAccountNotice(user.email, "recovery_codes_generated");
  return { status: "generated", codes };
}

/**
 * Utilise un code de secours : la validation en deux étapes est levée et le
 * compte revient à la connexion par mot de passe. Appelée dans la session
 * ouverte par le seul mot de passe.
 */
export async function redeemRecoveryCode(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "session_expired" };

  const code = text(formData, "recoveryCode").slice(0, 60);
  if (code.replace(/[^A-Za-z0-9]/g, "").length !== 16) {
    return { status: "error", error: "invalid_code" };
  }
  if ((await checkAttempt("second-factor", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited" };
  }

  const supabase = await createSessionClient();
  const { data: accepted, error } = await supabase.rpc("redeem_recovery_code", { code });
  if (error) {
    return {
      status: "error",
      error:
        error.message === "rate_limited"
          ? "rate_limited"
          : error.message === "last_super_admin"
            ? "last_super_admin_recovery"
            : "unavailable",
    };
  }
  if (accepted !== true) return { status: "error", error: "invalid_code" };

  // Le code est consommé et l'usage journalisé : le second facteur est levé par
  // le service d'authentification. L'identifiant vient de la session vérifiée.
  const admin = createServiceClient();
  const factors = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (factors.error) return { status: "error", error: "unavailable" };
  for (const factor of factors.data.factors) {
    const removed = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
    if (removed.error) return { status: "error", error: "unavailable" };
  }

  // Les codes restants étaient liés à ce second facteur : la base ne les
  // accepte plus. Les autres sessions du compte sont fermées — si l'appareil a
  // été volé, les siennes aussi.
  const session = await createSessionClient();
  await session.auth.signOut({ scope: "others" });
  await session.rpc("discard_recovery_codes");
  // Le titulaire est prévenu par courriel : si ce n'est pas lui, il le saura
  // même sans rouvrir la plateforme.
  await sendAccountNotice(user.email, "recovery_code_used");

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/account/security", query: { notice: "recovered" } },
    locale,
  });
}
