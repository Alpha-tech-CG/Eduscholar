"use server";

import { noteSignInDevice } from "./device";
import { recordAuthEvent } from "./events";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import { checkAttempt } from "./rate-limit";
import { safeNextPath } from "./redirect";
import {
  confirmTokenSchema,
  fieldErrors,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./schemas";
import { getCurrentUser, isRecentRecoverySession } from "./session";
import type { AuthFormState, SignInNotice } from "./state";

// Chaque action est un point d'entrée public (ADR-0003) : elle valide ses
// entrées, applique la limitation de débit et ne renvoie que des codes.
// Les messages d'erreur ne distinguent jamais « compte inexistant » de
// « mot de passe faux » (modèle de menaces M-02).

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const rateLimited: AuthFormState = { status: "error", error: "rate_limited" };

/**
 * Durée plancher d'une réponse. Elle réduit l'écart de temps entre un compte
 * existant et un compte inconnu, qui permettrait de les distinguer (M-02).
 */
const MINIMUM_RESPONSE_MS = 700;

async function withMinimumDuration<T>(work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    const remaining = MINIMUM_RESPONSE_MS - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

async function redirectToSignIn(notice: SignInNotice): Promise<never> {
  const locale = await getLocale();
  return redirect({ href: { pathname: "/sign-in", query: { notice } }, locale });
}

export async function signUp(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const submittedEmail = text(formData, "email").trim().slice(0, 254);
  const parsed = signUpSchema.safeParse({
    email: submittedEmail,
    password: text(formData, "password"),
    passwordConfirmation: text(formData, "passwordConfirmation"),
    ageConfirmed: text(formData, "ageConfirmed"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: fieldErrors(parsed.error),
      values: { email: submittedEmail },
    };
  }

  const success: AuthFormState = { status: "success", notice: "check_email_signup" };

  return withMinimumDuration(async () => {
    const verdict = await checkAttempt("sign-up", parsed.data.email);
    if (verdict === "client_limited") return rateLimited;
    // Limite propre à cette adresse : même réponse que d'habitude, sans envoi.
    if (verdict === "account_limited") return success;

    const supabase = await createSessionClient();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error?.code === "weak_password") {
      return {
        status: "error",
        error: "weak_password",
        values: { email: parsed.data.email },
      };
    }

    // Toute autre issue donne la même réponse, que l'adresse soit déjà
    // enregistrée ou non.
    return success;
  });
}

export async function signIn(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const submittedEmail = text(formData, "email").trim().slice(0, 254);
  const parsed = signInSchema.safeParse({
    email: submittedEmail,
    password: text(formData, "password"),
  });
  const invalid: AuthFormState = {
    status: "error",
    error: "invalid_credentials",
    values: { email: submittedEmail },
  };
  if (!parsed.success) return invalid;

  const failure = await withMinimumDuration(async () => {
    if ((await checkAttempt("sign-in", parsed.data.email)) !== "allowed") {
      return rateLimited;
    }

    const supabase = await createSessionClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user) {
      await recordAuthEvent("failed:sign-in");
      return invalid;
    }
    // Le mot de passe est accepté : un navigateur inconnu du compte prévient
    // le titulaire, à l'adresse que le service d'authentification lui connaît.
    await noteSignInDevice(data.user);
    return null;
  });
  if (failure) return failure;

  const locale = await getLocale();
  return redirect({ href: safeNextPath(text(formData, "next")), locale });
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  // Révoque la session côté serveur d'authentification, pas seulement le cookie.
  await supabase.auth.signOut();

  const locale = await getLocale();
  redirect({ href: "/", locale });
}

export async function requestPasswordReset(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const submittedEmail = text(formData, "email").trim().slice(0, 254);
  const parsed = forgotPasswordSchema.safeParse({ email: submittedEmail });
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: fieldErrors(parsed.error),
      values: { email: submittedEmail },
    };
  }

  const success: AuthFormState = { status: "success", notice: "check_email_reset" };

  return withMinimumDuration(async () => {
    const verdict = await checkAttempt("password-reset", parsed.data.email);
    if (verdict === "client_limited") return rateLimited;
    // Limite propre à ce compte : un tiers ne peut ni inonder sa boîte, ni
    // savoir que la limite est atteinte.
    if (verdict === "account_limited") return success;

    const supabase = await createSessionClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email);

    // Même réponse que le compte existe ou non.
    return success;
  });
}

/**
 * Consomme le jeton reçu par courriel. Déclenchée par un bouton, jamais par le
 * simple chargement du lien : aucune modification par GET.
 *
 * Deux protections contre un lien envoyé par un tiers malveillant :
 *
 *  - une personne déjà connectée doit d'abord se déconnecter : sa session n'est
 *    jamais remplacée en silence par celle d'un autre compte ;
 *  - la confirmation d'une adresse n'ouvre pas de session. Il faut ensuite se
 *    connecter avec son mot de passe. Si quelqu'un d'autre avait inscrit cette
 *    adresse avant son titulaire, celui-ci ne peut pas entrer sans passer par
 *    « mot de passe oublié », ce qui remplace le mot de passe de l'intrus.
 */
export async function confirmEmailToken(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = confirmTokenSchema.safeParse({
    tokenHash: text(formData, "tokenHash"),
    type: text(formData, "type"),
  });
  const invalid: AuthFormState = { status: "error", error: "invalid_link" };
  if (!parsed.success) return invalid;

  if (await getCurrentUser()) return { status: "error", error: "already_signed_in" };

  if ((await checkAttempt("token-confirm")) !== "allowed") return rateLimited;

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: parsed.data.tokenHash,
    type: parsed.data.type,
  });
  if (error) return invalid;

  if (parsed.data.type === "email") {
    // La session ouverte par la vérification est refermée aussitôt.
    await supabase.auth.signOut();
    return redirectToSignIn("email-confirmed");
  }

  const locale = await getLocale();
  return redirect({ href: "/reset-password", locale });
}

/**
 * Choisit un nouveau mot de passe. Réservée à la session ouverte, il y a peu,
 * par le lien de réinitialisation.
 */
export async function updatePassword(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  // Contrôle d'accès dans l'action elle-même (modèle de menaces M-53).
  const user = await getCurrentUser();
  if (!user || !(await isRecentRecoverySession())) {
    return { status: "error", error: "session_expired" };
  }

  const parsed = resetPasswordSchema.safeParse({
    password: text(formData, "password"),
    passwordConfirmation: text(formData, "passwordConfirmation"),
  });
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: fieldErrors(parsed.error) };
  }

  if ((await checkAttempt("password-update")) !== "allowed") return rateLimited;

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    if (error.code === "weak_password") return { status: "error", error: "weak_password" };
    if (error.code === "same_password") return { status: "error", error: "same_password" };
    if (error.code === "reauthentication_needed" || error.code === "session_not_found") {
      return { status: "error", error: "session_expired" };
    }
    return { status: "error", error: "unavailable" };
  }

  // Toutes les sessions sont fermées, celle-ci comprise : un mot de passe
  // changé après une compromission ne laisse aucune session ouverte, et la
  // personne se reconnecte avec l'adresse et le mot de passe qu'elle connaît.
  await supabase.auth.signOut({ scope: "global" });

  return redirectToSignIn("password-updated");
}
