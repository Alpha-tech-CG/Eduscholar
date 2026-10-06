import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { SourceFormFields } from "@/components/projects/source-form-fields";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";
import { addSource } from "@/lib/projects/source-actions";
import { getNotes, getSources, parsePage } from "@/lib/projects/source-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.sources");
  return { title: t("title"), robots: { index: false } };
}

export default async function ProjectSourcesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/sources">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/sources`);

  const project = await getProject(id);
  if (!project) notFound();

  const { notice, page } = await searchParams;
  const [t, tType, listing] = await Promise.all([
    getTranslations("Projects.sources"),
    getTranslations("Projects.sources.type"),
    getSources(project.id, parsePage(page)),
  ]);
  const notes = await getNotes(listing.sources.map((source) => source.id));
  const pageHref = (target: number) =>
    target > 1
      ? { pathname: `/projects/${project.id}/sources`, query: { page: String(target) } }
      : `/projects/${project.id}/sources`;

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro", { project: project.title })}
      footer={
        <p>
          <Link href={`/projects/${project.id}`} className="underline underline-offset-4">
            {t("backToProject")}
          </Link>
        </p>
      }
    >
      {notice === "deleted" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("deleted")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("list", { count: listing.total })}</h2>
        {listing.total > 0 ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            <li>
              <Link href={`/projects/${project.id}/matrix`} className="underline underline-offset-4">
                {t("toMatrix")}
              </Link>
            </li>
            <li>
              <Link
                href={`/projects/${project.id}/bibliography`}
                className="underline underline-offset-4"
              >
                {t("toBibliography")}
              </Link>
            </li>
          </ul>
        ) : null}
        {listing.failed ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {t("loadFailed")}
          </p>
        ) : listing.sources.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {listing.sources.map((source) => (
              <li key={source.id} className="rounded border border-foreground/20 p-3">
                <Link
                  href={`/projects/${project.id}/sources/${source.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {source.title}
                </Link>
                <p className="text-sm opacity-80">
                  {[
                    tType(source.sourceType as "other"),
                    source.authors.slice(0, 3).join(", "),
                    source.publicationYear?.toString(),
                  ]
                    .filter(Boolean)
                    .join(t("separator"))}
                </p>
                <p className="text-sm opacity-70" data-testid="note-state">
                  {notes.has(source.id) ? t("hasNote") : t("noNote")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {listing.lastPage > 1 ? (
          <nav aria-label={t("pagination")} className="flex items-center justify-between gap-4">
            {listing.page > 1 ? (
              <Link href={pageHref(listing.page - 1)} className="underline underline-offset-4">
                {t("previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm opacity-70">
              {t("page", { page: listing.page, pages: listing.lastPage })}
            </span>
            {listing.page < listing.lastPage ? (
              <Link href={pageHref(listing.page + 1)} className="underline underline-offset-4">
                {t("next")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("addHeading")}</h2>
        <p className="text-sm opacity-80">{t("addIntro")}</p>
        <AuthForm action={addSource} submitLabel={t("add")} pendingLabel={t("pending")}>
          <input type="hidden" name="projectId" value={project.id} />
          <SourceFormFields />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
