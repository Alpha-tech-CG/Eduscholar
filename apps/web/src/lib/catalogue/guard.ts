import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import type { User } from "@/lib/supabase/server";
import { isModerator } from "./queries";

/**
 * Pour les pages de modération. Une personne qui n'est pas modératrice reçoit
 * une page introuvable : l'existence de ces pages n'est pas révélée.
 *
 * Ce n'est qu'un aiguillage : chaque lecture passe par la RLS et chaque
 * décision par une fonction de la base qui revérifie le rôle et le second facteur.
 */
export async function requireModerator(nextPath: string): Promise<User> {
  const user = await requireUser(nextPath);
  if (!(await isModerator())) notFound();
  return user;
}
