// Règles du texte d'une section, sans dépendance : ce module est importé par
// l'éditeur, qui s'exécute dans le navigateur. Les schémas de validation (zod)
// restent dans section-schemas.ts, côté serveur ; les importer ici enverrait
// toute la bibliothèque au navigateur (budget de performance, ADR-0012).

export const SECTION_BODY_MAX = 30000;

/** Nombre de mots d'un texte. */
export function countWords(text: string | null): number {
  return text ? (text.match(/[\p{L}\p{N}]+(?:[\u2019'-][\p{L}\p{N}]+)*/gu) ?? []).length : 0;
}
