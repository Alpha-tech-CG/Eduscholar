import "server-only";
import { cookies } from "next/headers";
import { isSessionCookie } from "@/lib/supabase/cookies";

/** Vrai si la requête porte un cookie de session. Ne prouve rien : simple raccourci pour éviter un appel réseau. */
export async function hasSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.getAll().some(({ name }) => isSessionCookie(name));
}
