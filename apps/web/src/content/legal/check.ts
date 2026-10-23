// Contrôle du build : la production ne part pas avec des pages juridiques
// incomplètes. Module pur, sans dépendance au cadre : `next.config.ts`
// l'appelle avant de construire, et les tests l'appellent directement.

/** Clés dont la valeur est vide (ou faite d'espaces). */
export function missingLegalValues(entity: Readonly<Record<string, string>>): string[] {
  return Object.entries(entity)
    .filter(([, value]) => value.trim() === "")
    .map(([key]) => key);
}

/**
 * Lève une erreur si l'on construit la production Vercel et qu'une information
 * manque. Hors de la production — local, intégration continue, aperçus — une
 * valeur vide est permise : les pages l'affichent « [à compléter] ».
 */
export function assertLegalEntityComplete(
  env: Readonly<Record<string, string | undefined>>,
  entity: Readonly<Record<string, string>>,
): void {
  if (env.VERCEL_ENV !== "production") return;
  const missing = missingLegalValues(entity);
  if (missing.length > 0) {
    throw new Error(
      `Pages juridiques incomplètes : renseignez ${missing.join(", ")} dans apps/web/src/content/legal/entity.ts avant de construire la production.`,
    );
  }
}
