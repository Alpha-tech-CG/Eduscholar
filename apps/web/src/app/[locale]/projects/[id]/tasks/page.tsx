import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthPageShell } from "@/components/auth/page-shell";
import { TaskBoard } from "@/components/projects/task-board";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProjectTasks } from "@/lib/projects/task-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Tasks");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  "task-added": "noticeAdded",
  "task-done": "noticeDone",
  "task-reopened": "noticeReopened",
  "task-deleted": "noticeDeleted",
} as const;

/** Tâches et échéances d'un projet, pour son propriétaire. */
export default async function ProjectTasksPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/tasks">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/tasks`);

  // Projet inexistant, supprimé, ou fermé à l'utilisateur : même réponse.
  const listing = await getProjectTasks(id);
  if (!listing || listing.role !== "owner") notFound();

  const [t, { notice }] = await Promise.all([getTranslations("Tasks"), searchParams]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("introOwner")}
      footer={
        <p>
          <Link href={`/projects/${id}`} className="underline underline-offset-4">
            {t("backToProject")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}
      <TaskBoard
        scope="owner"
        projectId={id}
        listing={listing}
        today={new Date().toISOString().slice(0, 10)}
      />
    </AuthPageShell>
  );
}
