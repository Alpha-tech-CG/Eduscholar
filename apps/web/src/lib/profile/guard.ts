import "server-only";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import type { User } from "@/lib/supabase/server";
import { getOwnProfile, type Profile } from "./queries";

/**
 * Pour les pages réservées aux comptes qui ont complété leur profil et déclaré
 * leur âge. La base impose la même règle à chaque écriture
 * (`private.is_onboarded`) : cette redirection n'est qu'un confort.
 */
export async function requireOnboardedUser(
  nextPath: string,
): Promise<{ user: User; profile: Profile }> {
  const user = await requireUser(nextPath);
  const profile = await getOwnProfile();

  if (!profile?.onboarded) {
    return redirect({ href: "/account/profile", locale: await getLocale() });
  }
  return { user, profile };
}
