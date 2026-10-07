import "server-only";
import { z } from "zod";
import { createSessionClient } from "@/lib/supabase/server";

// Commentaires d'un projet partagé, lus par une fonction de la base qui vérifie
// à chaque appel la place de l'utilisateur dans le projet.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PROJECT_ROLES = ["owner", "supervisor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

const role = z.enum(PROJECT_ROLES);
const schema = z.object({
  role,
  comments: z.array(
    z.object({
      id: z.uuid(),
      section_id: z.uuid(),
      parent_id: z.uuid().nullable(),
      mine: z.boolean(),
      author_role: role.nullable().catch(null),
      author_email: z.string().nullable(),
      body: z.string().nullable(),
      quote: z.string().nullable(),
      created_at: z.string(),
      edited: z.boolean(),
      deleted: z.boolean(),
      resolved_at: z.string().nullable(),
    }),
  ),
});

export type Comment = {
  id: string;
  mine: boolean;
  authorRole: ProjectRole | null;
  authorEmail: string | null;
  body: string | null;
  quote: string | null;
  createdAt: string;
  edited: boolean;
  deleted: boolean;
};

export type Thread = Comment & { resolved: boolean; replies: Comment[] };

export type ProjectComments = {
  /** Place de l'utilisateur dans le projet. */
  role: ProjectRole;
  /** Fils de discussion par section, dans l'ordre de leur création. */
  bySection: Map<string, Thread[]>;
};

/** `null` : projet inexistant, supprimé, ou fermé à l'utilisateur — même réponse. */
export async function getProjectComments(projectId: string): Promise<ProjectComments | null> {
  if (!UUID.test(projectId)) return null;
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("project_comments", { project_id: projectId });
  const parsed = schema.safeParse(data);
  if (error || !parsed.success) return null;

  const toComment = (row: (typeof parsed.data.comments)[number]): Comment => ({
    id: row.id,
    mine: row.mine,
    authorRole: row.author_role,
    authorEmail: row.author_email,
    body: row.body,
    quote: row.quote,
    createdAt: row.created_at,
    edited: row.edited,
    deleted: row.deleted,
  });

  const threads = new Map<string, Thread>();
  const bySection = new Map<string, Thread[]>();
  for (const row of parsed.data.comments) {
    if (row.parent_id) continue;
    const thread: Thread = { ...toComment(row), resolved: row.resolved_at !== null, replies: [] };
    threads.set(row.id, thread);
    bySection.set(row.section_id, [...(bySection.get(row.section_id) ?? []), thread]);
  }
  for (const row of parsed.data.comments) {
    if (row.parent_id) threads.get(row.parent_id)?.replies.push(toComment(row));
  }
  return { role: parsed.data.role, bySection };
}

/** Nombre de fils ouverts par section. */
export function openThreadCounts(comments: ProjectComments): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [sectionId, threads] of comments.bySection) {
    counts.set(sectionId, threads.filter((thread) => !thread.resolved).length);
  }
  return counts;
}
