"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";

/** Marque comme lues toutes les notifications de l'utilisateur. */
export async function markNotificationsRead(): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return { status: "error", error: "session_expired" };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("mark_notifications_read");
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/notifications", query: { notice: "read" } }, locale });
}
