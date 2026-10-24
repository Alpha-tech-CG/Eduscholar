"use server";

import { z } from "zod";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { getFullySignedInUser } from "@/lib/auth/session";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import {
  IMPORT_MAX_BYTES,
  parseReferences,
  utf8Length,
  type DroppedField,
  type ImportFormat,
  type RejectionCode,
} from "@/lib/library/reference-import";
import { createSessionClient } from "@/lib/supabase/server";
import { getProject } from "./queries";

// Import de références BibTeX ou RIS dans les sources d'un projet de
// l'utilisateur. Deux temps : un aperçu (rien n'est écrit), puis l'import.
// Le fichier n'est jamais stocké : il est lu en mémoire, analysé, et seul son
// texte revient au navigateur avec l'aperçu, pour être renvoyé à l'import, où
// il est analysé de nouveau (rien de ce que renvoie le navigateur n'est cru).
// Rien n'est créé au catalogue public. Aucun contenu du fichier ne va au journal.

export type ImportErrorCode =
  | "session_expired"
  | "validation"
  | "too_large"
  | "unknown_format"
  | "empty"
  | "rate_limited"
  | "not_found"
  | "limit_reached"
  | "unavailable";

export type ImportRejection = {
  index: number;
  label: string;
  code: RejectionCode | "duplicate" | "invalid" | "limit_reached" | "rate_limited";
};

export type ImportPreviewEntry = {
  index: number;
  title: string;
  authors: string;
  year: string;
  sourceType: string;
  dropped: DroppedField[];
};

export type ImportState =
  | { status: "idle" }
  | { status: "error"; error: ImportErrorCode }
  | {
      status: "preview";
      format: ImportFormat;
      content: string;
      entries: ImportPreviewEntry[];
      rejected: ImportRejection[];
    }
  | { status: "done"; created: number; rejected: ImportRejection[] };

/** Entrées par appel à `import_project_sources` (borne de la base). */
const IMPORT_BATCH = 200;

const resultSchema = z.object({
  created: z.number().int().min(0),
  rejected: z
    .array(
      z.object({
        index: z.number().int().min(0),
        code: z.enum(["duplicate", "invalid", "limit_reached", "rate_limited"]),
      }),
    )
    .max(IMPORT_BATCH),
});

async function readContent(formData: FormData): Promise<string | ImportErrorCode> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > IMPORT_MAX_BYTES) return "too_large";
    return file.text();
  }
  const content = formData.get("content");
  if (typeof content !== "string") return "empty";
  // Contrôle sur la longueur avant le décompte exact, pour ne pas parcourir un texte démesuré.
  if (content.length > IMPORT_MAX_BYTES || utf8Length(content) > IMPORT_MAX_BYTES) return "too_large";
  return content;
}

export async function importReferences(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await getFullySignedInUser();
  if (!user) return { status: "error", error: "session_expired" };

  const projectId = z.uuid().safeParse(formData.get("projectId"));
  const intent = z.enum(["preview", "import"]).safeParse(formData.get("intent"));
  if (!projectId.success || !intent.success) return { status: "error", error: "validation" };

  if ((await checkAttempt("reference-import", user.id)) !== "allowed") {
    return { status: "error", error: "rate_limited" };
  }

  const content = await readContent(formData);
  if (content === "too_large" || content === "empty") return { status: "error", error: content };
  if (content.trim() === "") return { status: "error", error: "empty" };

  const parsed = parseReferences(content);
  if (parsed.tooLarge) return { status: "error", error: "too_large" };
  if (parsed.format === null) return { status: "error", error: "unknown_format" };

  const rejected: ImportRejection[] = parsed.rejected.map(({ index, label, code }) => ({ index, label, code }));

  if (intent.data === "preview") {
    // Le projet d'autrui et un projet inexistant répondent pareil.
    if (!(await getProject(projectId.data))) return { status: "error", error: "not_found" };
    return {
      status: "preview",
      format: parsed.format,
      content,
      entries: parsed.accepted.map(({ index, reference, dropped }) => ({
        index,
        title: reference.title,
        authors: reference.authors.slice(0, 3).join(" ; ") + (reference.authors.length > 3 ? " …" : ""),
        year: reference.publicationYear,
        sourceType: reference.sourceType,
        dropped,
      })),
      rejected,
    };
  }

  if (parsed.accepted.length === 0) return { status: "done", created: 0, rejected };

  // La base admet 200 entrées par appel : un fichier de 500 part en trois lots,
  // chacun compté par la limite de débit de la base.
  const supabase = await createSessionClient();
  let created = 0;
  for (let start = 0; start < parsed.accepted.length; start += IMPORT_BATCH) {
    const batch = parsed.accepted.slice(start, start + IMPORT_BATCH);
    const { data, error } = await supabase.rpc("import_project_sources", {
      project_id: projectId.data,
      entries: batch.map((entry) => entry.payload),
    });
    const result = error ? null : resultSchema.safeParse(data);
    if (error || !result?.success) {
      const code = error ? catalogueErrorCode(error) : "unavailable";
      // Rien d'écrit encore : l'erreur est rendue telle quelle.
      if (start === 0) {
        return {
          status: "error",
          error: code === "not_found" || code === "rate_limited" || code === "limit_reached" ? code : "unavailable",
        };
      }
      // Lot suivant refusé : ses entrées et les suivantes sont rapportées comme refusées.
      const refusal = code === "rate_limited" || code === "limit_reached" ? code : "invalid";
      for (const entry of parsed.accepted.slice(start)) {
        rejected.push({ index: entry.index, label: entry.reference.title.slice(0, 120), code: refusal });
      }
      break;
    }
    created += result.data.created;
    for (const refusal of result.data.rejected) {
      const entry = batch[refusal.index];
      if (entry) rejected.push({ index: entry.index, label: entry.reference.title.slice(0, 120), code: refusal.code });
    }
  }
  rejected.sort((a, b) => a.index - b.index);
  return { status: "done", created, rejected };
}
