import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getSharedProjects } from "@/lib/projects/sharing-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Sharing");
  return { title: t("sharedTitle"), robots: { index: false } };
}

/** Projets que d'autres ont partagés avec l'utilisateur. */
export default async function SharedProjectsPage({ searchParams }: PageProps<"/[locale]/shared">) {
  await requireOnboardedUser("/shared");
  const [t, tStatus, format, projects, { notice }] = await Promise.all([
    getTranslations("Sharing"),
    getTranslations("Projects.status"),
    getFormatter(),
    getSharedProjects(),
    searchParams,
  ]);

  return (
    <AuthPageShell
      wide
      title={t("sharedTitle")}
      intro={t("sharedIntro")}
      footer={
        <p>
          <Link href="/projects" className="underline underline-offset-4">
            {t("toMine")}
          </Link>
        </p>
      }
    >
      {notice === "left" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("noticeLeft")}
        </p>
      ) : null}

      {projects === null ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("loadFailed")}
        </p>
      ) : projects.length === 0 ? (
        <p className="opacity-70">{t("sharedEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li key={project.id} data-testid="shared-project" className="rounded border border-foreground/20 p-3">
              <Link href={`/shared/${project.id}`} className="font-medium underline underline-offset-4">
                {project.title}
              </Link>
              <p className="text-sm opacity-80">
                {[
                  project.ownerEmail ?? t("unknownMember"),
                  t(`roles.${project.role}`),
                  tStatus(project.status as "draft"),
                  project.dueDate
                    ? t("dueOn", {
                        date: format.dateTime(new Date(`${project.dueDate}T00:00:00Z`), {
                          dateStyle: "long",
                          timeZone: "UTC",
                        }),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(t("separator"))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AuthPageShell>
  );
}
