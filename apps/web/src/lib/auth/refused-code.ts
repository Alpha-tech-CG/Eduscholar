import "server-only";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { isSessionCookie, sessionCookieOptions } from "@/lib/supabase/cookies";

/** Le hook de la base a-t-il refusé l'essai (trop de codes faux, ou code déjà utilisé) ? */
export function isCodeRefusedByHook(error: { code?: string }): boolean {
  return error.code === "mfa_verification_rejected";
}

/**
 * Après un refus du hook, le service d'authentification a fermé toutes les
 * sessions du compte : le cookie est effacé et la personne renvoyée à la
 * connexion, avec une explication.
 */
export async function afterRefusedCode(): Promise<never> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (isSessionCookie(name)) cookieStore.set(name, "", sessionCookieOptions({ maxAge: 0 }));
  }
  const locale = await getLocale();
  return redirect({ href: { pathname: "/sign-in", query: { notice: "code-refused" } }, locale });
}
