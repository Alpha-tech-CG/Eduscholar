import { z } from "zod";

// Plan du mémoire : sections et sources citées. Les bornes reprennent celles de
// la base, qui reste seule à faire foi.

export const SECTION_LEVELS = ["1", "2", "3"] as const;
export const SECTION_BODY_MAX = 30000;

const empty = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const newSectionSchema = z.object({
  title: z.string().trim().min(1, "required").max(300, "too_long"),
  level: z.enum(SECTION_LEVELS, "invalid_choice"),
});

export const sectionSchema = newSectionSchema.extend({
  body: z.preprocess(empty, z.string().max(SECTION_BODY_MAX, "too_long").optional()),
});

export const citationSchema = z.object({
  sourceId: z.uuid("required"),
  pages: z.preprocess(empty, z.string().trim().max(50, "too_long").optional()),
});

/**
 * Numérotation hiérarchique d'un plan à partir des niveaux de ses sections,
 * dans l'ordre du document : « 1 », « 1.1 », « 1.1.1 », « 2 »…
 *
 * Un niveau sauté (une sous-section sans section) est compté à partir de un :
 * la numérotation décrit le plan tel qu'il est, sans le corriger.
 */
export function numberSections(levels: number[]): string[] {
  const counters = [0, 0, 0];
  return levels.map((raw) => {
    const level = Math.min(3, Math.max(1, Math.trunc(raw) || 1));
    counters[level - 1] = (counters[level - 1] ?? 0) + 1;
    for (let deeper = level; deeper < counters.length; deeper += 1) counters[deeper] = 0;
    return counters
      .slice(0, level)
      .map((count) => Math.max(1, count))
      .join(".");
  });
}

/** Nombre de mots d'un texte. */
export function countWords(text: string | null): number {
  return text ? (text.match(/[\p{L}\p{N}]+(?:[\u2019'-][\p{L}\p{N}]+)*/gu) ?? []).length : 0;
}
