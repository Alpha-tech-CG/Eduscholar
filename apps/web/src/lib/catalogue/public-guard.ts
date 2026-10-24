import "server-only";
import { cache } from "react";
import { checkAttempt } from "@/lib/auth/rate-limit";

/**
 * Limite par adresse des pages publiques lues sans compte (accueil, fiche ;
 * ADR-0014, MOYEN-1 c). Un seul décompte par requête : les métadonnées et la
 * page partagent ce résultat. Panne du compteur et limite atteinte donnent la
 * même réponse : la page s'affiche sans les lectures du catalogue.
 */
export const isPublicPageAllowed = cache(
  async (): Promise<boolean> => (await checkAttempt("public-page")) === "allowed",
);
