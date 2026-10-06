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
