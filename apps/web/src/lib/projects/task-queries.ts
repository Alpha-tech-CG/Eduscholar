import "server-only";
import { z } from "zod";
import { createSessionClient } from "@/lib/supabase/server";
import { PROJECT_ROLES, type ProjectRole } from "./comment-queries";

// Tâches et échéances d'un projet partagé, lues par une fonction de la base
// qui vérifie à chaque appel la place de l'utilisateur dans le projet.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const role = z.enum(PROJECT_ROLES);
const schema = z.object({
  role,
  tasks: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      details: z.string().nullable(),
      due_date: z.string().nullable(),
      done: z.boolean(),
      author_role: role.nullable().catch(null),
      editable: z.boolean(),
    }),
  ),
});

export type Task = {
  id: string;
  title: string;
  details: string | null;
  dueDate: string | null;
  done: boolean;
  authorRole: ProjectRole | null;
  /** L'utilisateur peut la modifier, la clore ou la supprimer. */
  editable: boolean;
};

export type ProjectTasks = { role: ProjectRole; tasks: Task[] };

/** `null` : projet inexistant, supprimé, ou fermé à l'utilisateur — même réponse. */
export async function getProjectTasks(projectId: string): Promise<ProjectTasks | null> {
  if (!UUID.test(projectId)) return null;
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("project_tasks", { project_id: projectId });
  const parsed = schema.safeParse(data);
  if (error || !parsed.success) return null;
  return {
    role: parsed.data.role,
    tasks: parsed.data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      details: task.details,
      dueDate: task.due_date,
      done: task.done,
      authorRole: task.author_role,
      editable: task.editable,
    })),
  };
}
