import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import {
  buildBibliography,
  referenceText,
  DOCUMENT_LOCALES,
  type BibliographyLocale,
} from "@/lib/projects/bibliography";
import { documentLocale } from "@/lib/projects/document-loader";
import { getProject } from "@/lib/projects/queries";
import { getAllSources } from "@/lib/projects/source-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.bibliography");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Bibliographie du projet (cahier §6.10). Elle est calculée à chaque affichage
 * à partir des seules sources du projet : rien n'y figure qui n'ait été saisi.
 */
export default async function ProjectBibliographyPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/bibliography">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/bibliography`);

  const project = await getProject(id);
  if (!project) notFound();

  const [uiLocale, t, sources, { lang }] = await Promise.all([
    getLocale(),
    getTranslations("Projects.bibliography"),
    getAllSources(project.id),
    searchParams,
  ]);
  // Langue de la bibliographie : celle du mémoire, qui peut différer de celle
  // de l'interface.
  const locale: BibliographyLocale = documentLocale(lang, uiLocale);

  const bibliography = sources ? buildBibliography(sources, locale) : null;
  const plainText = bibliography
    ? bibliography.references.map(referenceText).join("\n\n")
    : "";

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
      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("ruleOnlySources")}</li>
        <li>{t("ruleCheck")}</li>
        <li>{t("ruleAuthors")}</li>
      </ul>

      <nav aria-label={t("language")} className="flex flex-wrap items-center gap-4 text-sm">
        <span>{t("language")}</span>
        {DOCUMENT_LOCALES.map((code) =>
          code === locale ? (
            <span key={code} aria-current="true" className="font-semibold">
              {t(`languages.${code}`)}
            </span>
          ) : (
            <Link
              key={code}
              href={{ pathname: `/projects/${project.id}/bibliography`, query: { lang: code } }}
              className="underline underline-offset-4"
            >
              {t(`languages.${code}`)}
            </Link>
          ),
        )}
      </nav>

      {bibliography === null ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("loadFailed")}
        </p>
      ) : bibliography.references.length === 0 ? (
        <p className="opacity-70">{t("empty")}</p>
      ) : (
        <>
          <p data-testid="bibliography-summary" role="status">
            {t("summary", {
              count: bibliography.references.length,
              flagged: bibliography.flagged,
            })}
          </p>

          <section className="flex flex-col gap-3" lang={locale}>
            <h2 className="text-lg font-semibold">{t(`heading.${locale}`)}</h2>
            <ol className="flex list-none flex-col gap-4">
              {bibliography.references.map((reference) => (
                <li key={reference.sourceId} className="flex flex-col gap-1">
                  {/* Retrait suspendu, comme le veut la norme. */}
                  <p data-testid="reference" className="ps-8 -indent-8 break-words">
                    {reference.segments.map((segment, index) =>
                      segment.italic ? (
                        <em key={index}>{segment.text}</em>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      ),
                    )}
                  </p>
                  {reference.issues.length > 0 ? (
                    <ul
                      lang={uiLocale}
                      data-testid="reference-issues"
                      className="ms-8 list-disc ps-5 text-sm text-red-800 dark:text-red-300"
                    >
                      {reference.issues.map((issue) => (
                        <li key={issue}>{t(`issues.${issue}`)}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="ms-8 text-sm" lang={uiLocale}>
                    <Link
                      href={`/projects/${project.id}/sources/${reference.sourceId}`}
                      className="underline underline-offset-4"
                    >
                      {t("editSource")}
                    </Link>
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t("copyHeading")}</h2>
            <label htmlFor="bibliography-text" className="text-sm opacity-80">
              {t("copyHint")}
            </label>
            <textarea
              id="bibliography-text"
              readOnly
              rows={Math.min(20, Math.max(4, bibliography.references.length * 3))}
              value={plainText}
              lang={locale}
              className="rounded border border-foreground/30 bg-background px-3 py-2 font-mono text-sm"
            />
          </section>
        </>
      )}
    </AuthPageShell>
  );
}
