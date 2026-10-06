import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";
import { getNotes, getSources, parsePage } from "@/lib/projects/source-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.matrix");
  return { title: t("title"), robots: { index: false } };
}

/** Matrice de littérature (cahier §6.8) : une ligne par source, à partir des fiches de lecture. */
export default async function ProjectMatrixPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/matrix">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/matrix`);

  const project = await getProject(id);
  if (!project) notFound();

  const { page } = await searchParams;
  const [t, listing] = await Promise.all([
    getTranslations("Projects.matrix"),
    getSources(project.id, parsePage(page)),
  ]);
  const notes = await getNotes(listing.sources.map((source) => source.id));
  const cell = (value: string | null | undefined) =>
    value ? <span className="whitespace-pre-line">{value}</span> : <span className="opacity-50">{t("blank")}</span>;
  const pageHref = (target: number) =>
    target > 1
      ? { pathname: `/projects/${project.id}/matrix`, query: { page: String(target) } }
      : `/projects/${project.id}/matrix`;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="opacity-80">{t("intro", { project: project.title })}</p>
      </div>

      {listing.failed ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("loadFailed")}
        </p>
      ) : listing.sources.length === 0 ? (
        <p className="opacity-70">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("caption")}</caption>
            <thead>
              <tr className="border-b border-foreground/30 text-start">
                {(["source", "theme", "method", "result", "limit", "use"] as const).map((column) => (
                  <th key={column} scope="col" className="p-2 text-start align-bottom font-semibold">
                    {t(`columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listing.sources.map((source) => {
                const note = notes.get(source.id);
                return (
                  <tr key={source.id} className="border-b border-foreground/15 align-top">
                    <th scope="row" className="p-2 text-start font-normal">
                      <Link
                        href={`/projects/${project.id}/sources/${source.id}`}
                        className="font-medium underline underline-offset-4"
                      >
                        {source.title}
                      </Link>
                      <span className="block opacity-70">
                        {[source.authors.slice(0, 2).join(", "), source.publicationYear?.toString()]
                          .filter(Boolean)
                          .join(t("separator"))}
                      </span>
                    </th>
                    <td className="p-2">{cell(note?.concepts ?? note?.problem)}</td>
                    <td className="p-2">{cell(note?.method)}</td>
                    <td className="p-2">{cell(note?.results)}</td>
                    <td className="p-2">{cell(note?.limits)}</td>
                    <td className="p-2">{cell(note?.targetChapter ?? note?.projectLink)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

      <p>
        <Link href={`/projects/${project.id}/sources`} className="underline underline-offset-4">
          {t("backToSources")}
        </Link>
      </p>
    </section>
  );
}
