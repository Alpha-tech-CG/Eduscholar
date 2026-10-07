import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DocumentArticle } from "@/components/projects/document-article";
import { PrintButton } from "@/components/projects/print-button";
import { Link } from "@/i18n/navigation";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { documentLocale, loadDocument } from "@/lib/projects/document-loader";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.document");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Le mémoire en un seul document : titre, table des matières, sections,
 * bibliographie. La page s'imprime — ou s'enregistre en PDF — sans les
 * commandes de l'application.
 */
export default async function ProjectDocumentPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/document">) {
  const { id } = await params;
  const { user } = await requireOnboardedUser(`/projects/${id}/document`);

  const [uiLocale, t, { lang }] = await Promise.all([
    getLocale(),
    getTranslations("Projects.document"),
    searchParams,
  ]);
  const locale = documentLocale(lang, uiLocale);
  // Même lecture lourde que l'export : elle est limitée elle aussi.
  if ((await checkAttempt("document", user.id)) !== "allowed") {
    return (
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("rateLimited")}
        </p>
      </section>
    );
  }
  const loaded = await loadDocument(id, locale);
  if (loaded.status === "not_found") notFound();

  const { project } = loaded;
  const exportHref = (format: string) => `/${uiLocale}/projects/${project.id}/export/${format}?lang=${locale}`;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-10 print:max-w-none print:py-0">
      <div className="flex flex-col gap-4 print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="opacity-80">{t("intro")}</p>

        <nav aria-label={t("language")} className="flex flex-wrap items-center gap-4 text-sm">
          <span>{t("language")}</span>
          {(["fr", "en"] as const).map((code) =>
            code === locale ? (
              <span key={code} aria-current="true" className="font-semibold">
                {t(`languages.${code}`)}
              </span>
            ) : (
              <Link
                key={code}
                href={{ pathname: `/projects/${project.id}/document`, query: { lang: code } }}
                className="underline underline-offset-4"
              >
                {t(`languages.${code}`)}
              </Link>
            ),
          )}
        </nav>

        {loaded.status === "ok" ? (
          <div className="flex flex-wrap items-center gap-4">
            <PrintButton label={t("print")} />
            {/* Liens ordinaires : un téléchargement ne doit pas être préchargé. */}
            <a href={exportHref("docx")} className="underline underline-offset-4" download>
              {t("downloadDocx")}
            </a>
            <a href={exportHref("md")} className="underline underline-offset-4" download>
              {t("downloadMarkdown")}
            </a>
          </div>
        ) : null}
        <p className="text-sm opacity-70">{t("printHint")}</p>
        <p>
          <Link href={`/projects/${project.id}`} className="underline underline-offset-4">
            {t("backToProject")}
          </Link>
        </p>
        <hr className="border-foreground/20" />
      </div>

      {loaded.status !== "ok" ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {loaded.status === "too_large" ? t("tooLarge") : t("loadFailed")}
        </p>
      ) : (
        <DocumentArticle document={loaded.document} locale={locale} uiLocale={uiLocale} emptyLabel={t("empty")} />
      )}
    </section>
  );
}
