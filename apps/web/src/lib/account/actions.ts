"use server";

import { readCaptcha } from "@/lib/auth/captcha";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { isSessionCookie, sessionCookieOptions } from "@/lib/supabase/cookies";
import {
  createServiceClient,
  createSessionClient,
  verifyPassword,
} from "@/lib/supabase/server";

/**
 * Supprime le compte de l'utilisateur courant, à sa demande.
 *
 * Opération privilégiée de la liste fermée (authorization-model §7.5) :
 * « suppression de compte à la demande du titulaire », après
 * ré-authentification. Le mot de passe est redemandé : une session laissée
 * ouverte ne suffit pas à effacer un compte.
 *
 * Avant d'utiliser la clé de service, la base est interrogée sous la session
 * de l'utilisateur (`account_deletion_check`) : un compte suspendu ne peut pas
 * effacer sa suspension en se supprimant, et le dernier administrateur d'une
 * organisation doit d'abord transmettre l'administration. La base journalise
 * la demande, puis la suppression.
 */
export async function deleteAccount(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user?.email) return { status: "error", error: "session_expired" };

  const password = formData.get("password");
  const confirmed = formData.get("confirmDeletion") === "on";
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    return { status: "error", error: "invalid_credentials" };
  }
  if (!confirmed) {
    return { status: "error", error: "validation", fields: { confirmDeletion: "required" } };
  }

  // La clé du compteur est l'identifiant du compte, pas son adresse : ces
  // essais ne pèsent pas sur la limite de connexion du titulaire.
  if ((await checkAttempt("reauthentication", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited" };
  }
  if (!(await verifyPassword(user.email, password, readCaptcha(formData).token))) {
    return { status: "error", error: "invalid_credentials" };
  }

  const supabase = await createSessionClient();
  const { data: verdict, error: checkError } = await supabase.rpc("account_deletion_check");
  if (checkError) return { status: "error", error: "unavailable" };
  if (verdict === "last_org_admin") return { status: "error", error: "last_org_admin" };
  if (verdict === "last_super_admin") return { status: "error", error: "last_super_admin" };
  if (verdict !== "ok") return { status: "error", error: "unavailable" };

  // L'identifiant vient de la session vérifiée, jamais du formulaire.
  const { error } = await createServiceClient().auth.admin.deleteUser(user.id);
  if (error) return { status: "error", error: "unavailable" };

  // Le compte n'existe plus : la session est refermée, et son cookie effacé
  // même si le service d'authentification ne répond pas.
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Sans effet : le cookie est effacé ci-dessous.
  }
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    // Un cookie au préfixe __Host- ne s'efface qu'avec les mêmes attributs.
    if (isSessionCookie(name)) cookieStore.set(name, "", sessionCookieOptions({ maxAge: 0 }));
  }

  const locale = await getLocale();
  return redirect({
    href: { pathname: "/sign-in", query: { notice: "account-deleted" } },
    locale,
  });
}
