"use server";

import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { isSessionCookie, sessionCookieOptions } from "@/lib/supabase/cookies";
import { createSessionClient, verifyPassword } from "@/lib/supabase/server";
import { checkAttempt } from "./rate-limit";
import { nextAfterVerification } from "./redirect";
import { getSecondFactorState } from "./second-factor";
import { getCurrentUser, getFullySignedInUser } from "./session";
import type { AuthFormState } from "./state";

// Second facteur par application d'authentification (TOTP).
//
// La protection est en base : un compte qui a un facteur vérifié n'a aucun
// droit tant que sa session ne l'a pas présenté, et le nombre d'essais de code
// est borné par facteur par un hook du service d'authentification. Ces actions
// ne font que conduire l'activation et la saisie du code.

const CODE = /^\d{6}$/;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function normalizeCode(value: string): string {
  return value.replace(/\s+/g, "");
}

const invalidCode: AuthFormState = { status: "error", error: "invalid_code" };
const rateLimited: AuthFormState = { status: "error", error: "rate_limited" };
const expired: AuthFormState = { status: "error", error: "session_expired" };

/**
 * Le hook de la base a refusé l'essai : trop de codes faux sur ce facteur, ou
 * code déjà utilisé. Le service d'authentification ferme alors toutes les
 * sessions du compte ; le cookie, devenu inutile, est effacé et la personne est
 * renvoyée à la connexion avec une explication.
 */
async function afterRefusedCode(): Promise<never> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (isSessionCookie(name)) cookieStore.set(name, "", sessionCookieOptions({ maxAge: 0 }));
  }
  const locale = await getLocale();
  return redirect({
    href: { pathname: "/sign-in", query: { notice: "code-refused" } },
    locale,
  });
}

function isRefusedByHook(error: { code?: string }): boolean {
  return error.code === "mfa_verification_rejected";
}

export type EnrollmentState =
  | { status: "idle" }
  | {
      status: "error";
      error:
        | "session_expired"
        | "already_enabled"
        | "rate_limited"
        | "invalid_password"
        | "unavailable";
    }
  | { status: "enrolling"; qrCode: string; secret: string };

/**
 * Démarre l'activation : crée un facteur non vérifié et renvoie son secret.
 *
 * Le mot de passe est redemandé. Sans cela, une session laissée ouverte sur un
 * poste partagé permettrait à un tiers d'activer la validation en deux étapes
 * avec son propre téléphone, et d'écarter durablement le titulaire.
 */
export async function startSecondFactorEnrollment(
  _previous: EnrollmentState,
  formData: FormData,
): Promise<EnrollmentState> {
  const user = await getFullySignedInUser();
  if (!user?.email) return { status: "error", error: "session_expired" };
  if ((await getSecondFactorState()).enabled) {
    return { status: "error", error: "already_enabled" };
  }

  const password = text(formData, "password");
  if (password.length === 0 || password.length > 1024) {
    return { status: "error", error: "invalid_password" };
  }
  if ((await checkAttempt("reauthentication", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited" };
  }
  if (!(await verifyPassword(user.email, password))) {
    return { status: "error", error: "invalid_password" };
  }

  const supabase = await createSessionClient();

  // Les activations commencées puis abandonnées sont retirées.
  const existing = await supabase.auth.mfa.listFactors();
  for (const factor of existing.data?.all ?? []) {
    if (factor.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `EduScholar ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data || data.type !== "totp") return { status: "error", error: "unavailable" };

  return { status: "enrolling", qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Termine l'activation : le premier code prouve que l'application est bien configurée. */
export async function confirmSecondFactorEnrollment(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return expired;

  const code = normalizeCode(text(formData, "code"));
  if (!CODE.test(code)) return invalidCode;

  if ((await checkAttempt("second-factor", user.id)) !== "allowed") return rateLimited;

  const supabase = await createSessionClient();
  // Le facteur à confirmer est celui que le serveur a créé pour ce compte :
  // aucun identifiant ne vient du formulaire.
  const factors = await supabase.auth.mfa.listFactors();
  const pending = (factors.data?.all ?? []).filter(
    (factor) => factor.factor_type === "totp" && factor.status !== "verified",
  );
  const factor = pending[pending.length - 1];
  if (!factor) return expired;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return isRefusedByHook(error) ? afterRefusedCode() : invalidCode;

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/account/security", query: { notice: "enabled" } },
    locale,
  });
}

/** Saisie du code à la connexion, ou après un lien de réinitialisation. */
export async function verifySecondFactor(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getCurrentUser();
  if (!user) return expired;

  const code = normalizeCode(text(formData, "code"));
  if (!CODE.test(code)) return invalidCode;

  if ((await checkAttempt("second-factor", user.id)) !== "allowed") return rateLimited;

  const supabase = await createSessionClient();
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp.find(({ status }) => status === "verified");
  if (!factor) return expired;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return isRefusedByHook(error) ? afterRefusedCode() : invalidCode;

  const locale = await getLocale();
  return redirect({ href: nextAfterVerification(text(formData, "next")), locale });
}

/**
 * Désactivation. Exige une session où le second facteur est vérifié, et un
 * code saisi à l'instant : une session laissée ouverte ne suffit pas.
 *
 * Un compte qui détient un rôle privilégié ne peut pas la désactiver : ses
 * droits en dépendent, et la base les lui retirerait.
 */
export async function disableSecondFactor(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return expired;

  const supabase = await createSessionClient();
  const required = await supabase.rpc("must_keep_second_factor");
  if (required.error) return { status: "error", error: "unavailable" };
  if (required.data === true) return { status: "error", error: "second_factor_required" };

  const code = normalizeCode(text(formData, "code"));
  if (!CODE.test(code)) return invalidCode;

  if ((await checkAttempt("second-factor", user.id)) !== "allowed") return rateLimited;

  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp.find(({ status }) => status === "verified");
  if (!factor) return expired;

  const verification = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verification.error) {
    return isRefusedByHook(verification.error) ? afterRefusedCode() : invalidCode;
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  if (error) return { status: "error", error: "unavailable" };

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/account/security", query: { notice: "disabled" } },
    locale,
  });
}
