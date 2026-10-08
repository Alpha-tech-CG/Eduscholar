import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

// Notifications internes. La base ne rend que celles de l'utilisateur, sur des
// projets qui lui sont encore ouverts ; une notification ne porte aucun
// contenu, seulement ce qui s'est passé et où.

export const NOTIFICATION_KINDS = [
  "comment",
  "reply",
  "version_submitted",
  "version_decided",
  "task_added",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type Notification = {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  projectTitle: string;
  /** Page de l'application où se trouve ce que la notification désigne. */
  href: string;
};

type Row = {
  kind: string;
  scope: string;
  project_id: string;
  section_id: string | null;
  version_id: string | null;
};

/** L'adresse est reconstruite ici, à partir d'identifiants rendus par la base. */
function hrefOf(row: Row): string {
  const owner = row.scope === "owner";
  const base = `${owner ? "/projects" : "/shared"}/${row.project_id}`;
  if ((row.kind === "comment" || row.kind === "reply") && row.section_id) {
    return owner ? `${base}/outline/${row.section_id}` : `${base}/sections/${row.section_id}`;
  }
  if ((row.kind === "version_submitted" || row.kind === "version_decided") && row.version_id) {
    return `${base}/versions/${row.version_id}`;
  }
  if (row.kind === "task_added") return `${base}/tasks`;
  return base;
}

/** `null` si la lecture échoue. */
export async function getNotifications(): Promise<Notification[] | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("my_notifications");
  if (error) return null;
  return (data ?? [])
    .filter((row) => (NOTIFICATION_KINDS as readonly string[]).includes(row.kind))
    .map((row) => ({
      id: row.id,
      kind: row.kind as NotificationKind,
      createdAt: row.created_at,
      read: row.is_read,
      projectTitle: row.project_title,
      href: hrefOf(row),
    }));
}

/** Nombre de notifications non lues ; zéro si la lecture échoue. */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("my_unread_notification_count");
  return error || typeof data !== "number" ? 0 : data;
}
