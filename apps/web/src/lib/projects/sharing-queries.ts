import "server-only";
import { z } from "zod";
import { createSessionClient } from "@/lib/supabase/server";
import type { BibliographyLocale } from "./bibliography";
import { buildDocument, countLines, DOCUMENT_MAX_LINES, type ProjectDocument } from "./document";
import type { Citation } from "./section-queries";
import type { Source } from "./source-queries";

// Partage d'un projet. Tout est lu par des fonctions de la base, sous la session
// de l'utilisateur : elles vérifient à chaque appel qu'il est propriétaire, ou
// membre, du projet demandé.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const INVITATION_TOKEN = /^[0-9a-f]{64}$/;

export const MEMBER_ROLES = ["supervisor", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

const role = z.enum(MEMBER_ROLES);

const sharingSchema = z.object({
  members: z.array(
    z.object({
      user_id: z.uuid(),
      email: z.string().nullable(),
      role,
      joined_at: z.string(),
      full_access: z.boolean(),
      section_ids: z.array(z.uuid()),
    }),
  ),
  invitations: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      role,
      expires_at: z.string(),
      created_at: z.string(),
      full_access: z.boolean(),
    }),
  ),
  link: z.object({ role, expires_at: z.string() }).nullable(),
  requests: z.array(
    z.object({
      id: z.uuid(),
      email: z.string().nullable(),
      display_name: z.string().nullable(),
      role,
      created_at: z.string(),
    }),
  ),
});

export type ProjectSharing = {
  members: {
    userId: string;
    email: string | null;
    role: MemberRole;
    joinedAt: string;
    /** Faux : le membre ne lit que les sections de `sectionIds`. */
    fullAccess: boolean;
    sectionIds: string[];
  }[];
  invitations: { id: string; email: string; role: MemberRole; expiresAt: string; fullAccess: boolean }[];
  /** Lien de partage actif : son jeton n'est connu qu'à sa création. */
  link: { role: MemberRole; expiresAt: string } | null;
  /** Demandes faites par lien, en attente de l'accord du propriétaire. */
  requests: { id: string; email: string | null; displayName: string | null; role: MemberRole; createdAt: string }[];
};

/** Membres et invitations en attente d'un projet, pour son propriétaire. `null` sinon. */
export async function getProjectSharing(projectId: string): Promise<ProjectSharing | null> {
  if (!UUID.test(projectId)) return null;
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("project_sharing", { project_id: projectId });
  const parsed = sharingSchema.safeParse(data);
  if (error || !parsed.success) return null;

  return {
    members: parsed.data.members.map((member) => ({
      userId: member.user_id,
      email: member.email,
      role: member.role,
      joinedAt: member.joined_at,
      fullAccess: member.full_access,
      sectionIds: member.section_ids,
    })),
    invitations: parsed.data.invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expires_at,
      fullAccess: invitation.full_access,
    })),
    link: parsed.data.link ? { role: parsed.data.link.role, expiresAt: parsed.data.link.expires_at } : null,
    requests: parsed.data.requests.map((request) => ({
      id: request.id,
      email: request.email,
      displayName: request.display_name,
      role: request.role,
      createdAt: request.created_at,
    })),
  };
}

export type SharedProjectSummary = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  role: MemberRole;
  ownerEmail: string | null;
};

/** Projets partagés avec l'utilisateur. `null` si la lecture échoue. */
export async function getSharedProjects(): Promise<SharedProjectSummary[] | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("shared_projects");
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    role: role.catch("viewer").parse(row.role),
    ownerEmail: row.owner_email,
  }));
}

const previewSchema = z.object({
  project_title: z.string(),
  role,
  owner_email: z.string().nullable(),
  full_access: z.boolean(),
});

export type InvitationPreview = {
  projectTitle: string;
  role: MemberRole;
  ownerEmail: string | null;
  fullAccess: boolean;
};

/**
 * Ce que désigne un jeton d'invitation, s'il est valable et adressé à
 * l'utilisateur connecté. `null` dans tous les autres cas, sans distinction.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  if (!INVITATION_TOKEN.test(token)) return null;
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("invitation_preview", { token });
  const parsed = previewSchema.safeParse(data);
  if (error || !parsed.success) return null;
  return {
    projectTitle: parsed.data.project_title,
    role: parsed.data.role,
    ownerEmail: parsed.data.owner_email,
    fullAccess: parsed.data.full_access,
  };
}

/** Nombre de demandes de suivi que l'utilisateur a faites et qui attendent encore. */
export async function getPendingAccessRequestCount(): Promise<number> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("my_pending_access_requests");
  return error || typeof data !== "number" ? 0 : data;
}

const text = z.string().nullable();
const documentSchema = z.object({
  role,
  full_access: z.boolean(),
  project: z.object({
    id: z.uuid(),
    title: z.string(),
    status: z.string(),
    due_date: text,
    supervisor_name: text,
    problem_statement: text,
    main_question: text,
    general_objective: text,
    methodology: text,
  }),
  sections: z.array(z.object({ id: z.uuid(), level: z.number(), title: z.string(), body: text })),
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
});

export type SharedProject = {
  role: MemberRole;
  /** Faux : seules quelques sections sont ouvertes ; ni sources, ni versions, ni tâches. */
  fullAccess: boolean;
  title: string;
  status: string;
  dueDate: string | null;
  facts: { problemStatement: string | null; mainQuestion: string | null; generalObjective: string | null; methodology: string | null };
};

export type LoadedSharedDocument =
  | { status: "ok"; project: SharedProject; document: ProjectDocument }
  /** Projet inexistant, supprimé, ou dont l'utilisateur n'est pas membre : même réponse. */
  | { status: "not_found" }
  | { status: "too_large"; project: SharedProject };

/** Le projet partagé et son document, pour un membre. */
export async function loadSharedDocument(
  projectId: string,
  locale: BibliographyLocale,
): Promise<LoadedSharedDocument> {
  if (!UUID.test(projectId)) return { status: "not_found" };
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("shared_project_document", { project_id: projectId });
  const parsed = documentSchema.safeParse(data);
  if (error || !parsed.success) return { status: "not_found" };

  const { project: row, sections, sources: sourceRows, citations: citationRows } = parsed.data;
  const project: SharedProject = {
    role: parsed.data.role,
    fullAccess: parsed.data.full_access,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    facts: {
      problemStatement: row.problem_statement,
      mainQuestion: row.main_question,
      generalObjective: row.general_objective,
      methodology: row.methodology,
    },
  };

  const sources: Source[] = sourceRows.map((source) => ({
    id: source.id,
    projectId,
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
  for (const citation of citationRows) {
    const list = citations.get(citation.section_id) ?? [];
    list.push({ sourceId: citation.source_id, pages: citation.pages });
    citations.set(citation.section_id, list);
  }

  const document = buildDocument(
    { title: row.title, supervisorName: row.supervisor_name, sections, citations, sources },
    locale,
  );
  if (countLines(document) > DOCUMENT_MAX_LINES) return { status: "too_large", project };
  return { status: "ok", project, document };
}
