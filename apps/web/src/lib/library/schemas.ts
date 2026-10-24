import { z } from "zod";

const empty = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const collectionSchema = z.object({
  name: z.string().trim().min(1, "required").max(120, "too_long"),
  description: z.preprocess(empty, z.string().trim().max(1000, "too_long").optional()),
});

export const RETURN_TARGETS = ["resource", "library", "collection"] as const;

export const savedItemSchema = z.object({
  resourceId: z.uuid(),
  present: z.enum(["true", "false"]).transform((value) => value === "true"),
});

// Bornes répétées de la base (migration 20261006008500), qui seule fait foi.
export const NOTE_MAX_LENGTH = 2000;
export const TAG_MAX_LENGTH = 40;
export const TAGS_PER_FAVORITE = 10;
export const TAGS_PER_ACCOUNT = 100;

/** Note privée : vide efface la note. */
export const noteSchema = z.string().max(NOTE_MAX_LENGTH, "too_long");

/** Tag personnel : une ligne courte, ni virgule ni point-virgule. */
export const tagSchema = z
  .string()
  .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "required")
      .max(TAG_MAX_LENGTH, "too_long")
      .refine((value) => !/[,;]/.test(value), "invalid_choice"),
  );

/** Tag lu dans l'adresse de la bibliothèque, pour le filtre. */
export function parseTag(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.length > TAG_MAX_LENGTH * 4) return null;
  const parsed = tagSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
