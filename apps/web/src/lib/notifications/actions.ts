"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createServiceClient, createSessionClient } from "@/lib/supabase/server";
import { UNSUBSCRIBE_TOKEN } from "./queries";

/** Marque comme lues toutes les notifications de l'utilisateur. */
export async function markNotificationsRead(): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return { status: "error", error: "session_expired" };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("mark_notifications_read");
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/notifications", query: { notice: "read" } }, locale });
}

/** Demande, ou cesse de demander, le courriel des notifications. */
export async function setEmailDigest(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return { status: "error", error: "session_expired" };
  const enabled = formData.get("enabled");
  if (enabled !== "true" && enabled !== "false") return { status: "error", error: "validation" };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_notification_preferences", {
    payload: { email_digest: enabled === "true" },
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/notifications", query: { notice: enabled === "true" ? "email-on" : "email-off" } },
    locale,
  });
}

/**
 * Désabonne qui présente le jeton d'un courriel, sans session : la personne
 * doit pouvoir le faire depuis n'importe quel appareil. Le jeton ne permet que
 * cela. La réponse est la même qu'il soit valable ou non.
 */
export async function unsubscribe(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if ((await checkAttempt("unsubscribe")) !== "allowed") return { status: "error", error: "rate_limited" };
  const token = formData.get("token");

  const { error } = await createServiceClient().rpc("unsubscribe_notifications", {
    p_token: typeof token === "string" && UNSUBSCRIBE_TOKEN.test(token) ? token : "",
  });
  if (error) return { status: "error", error: "unavailable" };

  const locale = await getLocale();
  return redirect({ href: "/unsubscribe/done", locale });
}
