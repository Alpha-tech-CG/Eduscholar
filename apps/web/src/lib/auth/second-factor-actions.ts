"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import { checkAttempt } from "./rate-limit";
import { safeNextPath } from "./redirect";
import { getSecondFactorState } from "./second-factor";
import { getCurrentUser, getFullySignedInUser } from "./session";
import type { AuthFormState } from "./state";

// Second facteur par application d'authentification (TOTP).
//
// La protection est en base : un compte qui a un facteur vérifié n'a aucun
// droit tant que sa session ne l'a pas présenté. Ces actions ne font que
// conduire l'activation et la saisie du code.

const CODE = /^\d{6}$/;
const FACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

export type EnrollmentState =
  | { status: "idle" }
  | { status: "error"; error: "session_expired" | "already_enabled" | "rate_limited" | "unavailable" }
  | { status: "enrolling"; factorId: string; qrCode: string; secret: string };

/** Démarre l'activation : crée un facteur non vérifié et renvoie son secret. */
export async function startSecondFactorEnrollment(): Promise<EnrollmentState> {
  const user = await getFullySignedInUser();
  if (!user) return { status: "error", error: "session_expired" };
  if ((await getSecondFactorState()).enabled) {
    return { status: "error", error: "already_enabled" };
  }
  if ((await checkAttempt("second-factor", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited" };
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

  return {
    status: "enrolling",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Termine l'activation : le premier code prouve que l'application est bien configurée. */
export async function confirmSecondFactorEnrollment(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return expired;

  const factorId = text(formData, "factorId");
  const code = normalizeCode(text(formData, "code"));
  if (!FACTOR_ID.test(factorId) || !CODE.test(code)) return invalidCode;

  if ((await checkAttempt("second-factor", user.id)) !== "allowed") return rateLimited;

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return invalidCode;

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/account/security", query: { notice: "enabled" } },
    locale,
  });
}

/** Saisie du code à la connexion. */
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
  if (error) return invalidCode;

  const locale = await getLocale();
  return redirect({ href: safeNextPath(text(formData, "next")), locale });
}

/**
 * Désactivation. Exige une session où le second facteur est vérifié, et un
 * code saisi à l'instant : une session laissée ouverte ne suffit pas.
 */
export async function disableSecondFactor(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return expired;

  const code = normalizeCode(text(formData, "code"));
  if (!CODE.test(code)) return invalidCode;

  if ((await checkAttempt("second-factor", user.id)) !== "allowed") return rateLimited;

  const supabase = await createSessionClient();
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp.find(({ status }) => status === "verified");
  if (!factor) return expired;

  const verification = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verification.error) return invalidCode;

  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  if (error) return { status: "error", error: "unavailable" };

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/account/security", query: { notice: "disabled" } },
    locale,
  });
}
