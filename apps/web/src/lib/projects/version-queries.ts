import "server-only";
import { z } from "zod";
import { createSessionClient } from "@/lib/supabase/server";
import type { BibliographyLocale } from "./bibliography";
import { PROJECT_ROLES, type ProjectRole } from "./comment-queries";
import { buildDocument, countLines, DOCUMENT_MAX_LINES, type ProjectDocument } from "./document";
import type { Citation } from "./section-queries";
import type { Source } from "./source-queries";
import { compareSections, type VersionChanges } from "./version-compare";

// Versions soumises d'un projet, lues par des fonctions de la base qui
// vérifient à chaque appel la place de l'utilisateur dans le projet.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const DECISIONS = ["accepted", "changes_requested", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];

const role = z.enum(PROJECT_ROLES);
const text = z.string().nullable();

const listSchema = z.object({
  role,
  versions: z.array(
    z.object({
      id: z.uuid(),
      number: z.number(),
      label: text,
      note: text,
      word_count: z.number(),
      section_count: z.number(),
      erased: z.boolean(),
      created_at: z.string(),
      decisions: z.array(
        z.object({
          decision: z.enum(DECISIONS),
          comment: text,
          decided_at: z.string(),
          mine: z.boolean(),
          decided_by_email: text,
        }),
      ),
    }),
  ),
});

export type VersionDecision = {
  decision: Decision;
  comment: string | null;
  decidedAt: string;
  mine: boolean;
  decidedByEmail: string | null;
};

export type VersionSummary = {
  id: string;
  number: number;
  label: string | null;
  note: string | null;
  wordCount: number;
  sectionCount: number;
  /** Contenu effacé par son auteur : seule la trace de la soumission reste. */
  erased: boolean;
  createdAt: string;
  /** De la plus ancienne à la plus récente : la dernière fait foi. */
  decisions: VersionDecision[];
};

export type ProjectVersions = { role: ProjectRole; versions: VersionSummary[] };

/** `null` : projet inexistant, supprimé, ou fermé à l'utilisateur — même réponse. */
export async function getProjectVersions(projectId: string): Promise<ProjectVersions | null> {
  if (!UUID.test(projectId)) return null;
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("project_versions", { project_id: projectId });
  const parsed = listSchema.safeParse(data);
  if (error || !parsed.success) return null;

  return {
    role: parsed.data.role,
    versions: parsed.data.versions.map((version) => ({
      id: version.id,
      number: version.number,
      label: version.label,
      note: version.note,
      wordCount: version.word_count,
      sectionCount: version.section_count,
      erased: version.erased,
      createdAt: version.created_at,
      decisions: version.decisions.map((decision) => ({
        decision: decision.decision,
        comment: decision.comment,
        decidedAt: decision.decided_at,
        mine: decision.mine,
        decidedByEmail: decision.decided_by_email,
      })),
    })),
  };
}

const sectionSchema = z.object({ id: z.uuid(), level: z.number(), title: z.string(), body: text });
const digestSchema = z.object({ id: z.string(), level: z.number(), title: z.string(), digest: z.string() });
const versionSchema = z.object({
  role,
  project_id: z.uuid(),
  id: z.uuid(),
  number: z.number(),
  label: text,
  note: text,
  created_at: z.string(),
  snapshot: z.object({
    title: z.string(),
    supervisor_name: text.optional(),
    sections: z.array(sectionSchema),
    sources: z.array(
      z.object({
        id: z.uuid(),
        resource_id: text,
        source_type: z.string(),
        title: z.string(),
        authors: z.array(z.string()).nullable(),
        publication_year: z.number().nullable(),
        container_title: text,
        publisher: text,
        volume: text,
        issue: text,
        pages: text,
        doi: text,
        url: text,
        accessed_on: text,
      }),
    ),
    citations: z.array(z.object({ section_id: z.uuid(), source_id: z.uuid(), pages: text })),
  }),
  erased: z.boolean(),
  digests: z.array(digestSchema),
  previous_digests: z.array(digestSchema).nullable(),
});

export type LoadedVersion =
  | {
      status: "ok";
      role: ProjectRole;
      projectId: string;
      number: number;
      label: string | null;
      note: string | null;
      createdAt: string;
      erased: boolean;
      document: ProjectDocument;
      changes: VersionChanges;
    }
  /** Version inexistante, ou d'un projet fermé à l'utilisateur : même réponse. */
  | { status: "not_found" }
  | { status: "too_large"; role: ProjectRole; projectId: string; number: number; label: string | null };

export async function loadVersion(versionId: string, locale: BibliographyLocale): Promise<LoadedVersion> {
  if (!UUID.test(versionId)) return { status: "not_found" };
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("project_version", { version_id: versionId });
  const parsed = versionSchema.safeParse(data);
  if (error || !parsed.success) return { status: "not_found" };
  const { snapshot } = parsed.data;

  const sources: Source[] = snapshot.sources.map((source) => ({
    id: source.id,
    projectId: parsed.data.project_id,
    resourceId: source.resource_id,
    sourceType: source.source_type,
    title: source.title,
    authors: source.authors ?? [],
    publicationYear: source.publication_year,
    containerTitle: source.container_title,
    publisher: source.publisher,
    volume: source.volume,
    issue: source.issue,
    pages: source.pages,
    doi: source.doi,
    url: source.url,
    accessedOn: source.accessed_on,
  }));
  const citations = new Map<string, Citation[]>();
  for (const citation of snapshot.citations) {
    const list = citations.get(citation.section_id) ?? [];
    list.push({ sourceId: citation.source_id, pages: citation.pages });
    citations.set(citation.section_id, list);
  }

  const document = buildDocument(
    {
      title: snapshot.title,
      supervisorName: snapshot.supervisor_name ?? null,
      sections: snapshot.sections,
      citations,
      sources,
    },
    locale,
  );
  if (countLines(document) > DOCUMENT_MAX_LINES) {
    return {
      status: "too_large",
      role: parsed.data.role,
      projectId: parsed.data.project_id,
      number: parsed.data.number,
      label: parsed.data.label,
    };
  }

  return {
    status: "ok",
    role: parsed.data.role,
    projectId: parsed.data.project_id,
    number: parsed.data.number,
    label: parsed.data.label,
    note: parsed.data.note,
    createdAt: parsed.data.created_at,
    erased: parsed.data.erased,
    document,
    changes: parsed.data.erased ? null : compareSections(parsed.data.digests, parsed.data.previous_digests),
  };
}
