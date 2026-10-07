import { getFormatter, getTranslations } from "next-intl/server";
import { DocumentArticle } from "@/components/projects/document-article";
import type { LoadedVersion } from "@/lib/projects/version-queries";

// Une version soumise : ce qui a changé depuis la précédente, puis le document
// tel qu'il était. Rendue par la page du propriétaire et par celle d'un membre.

type Props = {
  version: Extract<LoadedVersion, { status: "ok" }>;
  locale: string;
  uiLocale: string;
};

export async function VersionDetail({ version, locale, uiLocale }: Props) {
  const [t, format] = await Promise.all([getTranslations("Versions"), getFormatter()]);
  const { changes } = version;
  const groups: Array<[string, string[]]> = changes
    ? [
        [t("changes.added"), changes.added],
        [t("changes.modified"), changes.modified],
        [t("changes.removed"), changes.removed],
      ]
    : [];
  const unchanged = changes !== null && groups.every(([, titles]) => titles.length === 0);

  return (
    <>
      <div className="flex flex-col gap-3 print:hidden">
        <p className="text-sm opacity-80">
          {t("submittedOn", {
            date: format.dateTime(new Date(version.createdAt), { dateStyle: "long", timeStyle: "short" }),
          })}
        </p>
        {version.note ? (
          <section className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{t("noteHeading")}</h2>
            <p className="whitespace-pre-line">{version.note}</p>
          </section>
        ) : null}
        <section className="flex flex-col gap-1" data-testid="version-changes">
          <h2 className="text-lg font-semibold">{t("changes.heading")}</h2>
          {version.erased ? (
            <p className="opacity-80">{t("changes.erased")}</p>
          ) : changes === null ? (
            <p className="opacity-80">{t("changes.first")}</p>
          ) : unchanged ? (
            <p className="opacity-80">{t("changes.none")}</p>
          ) : (
            groups.map(([heading, titles]) =>
              titles.length > 0 ? (
                <p key={heading}>
                  <span className="font-medium">{heading}</span> {titles.join(t("listSeparator"))}
                </p>
              ) : null,
            )
          )}
        </section>
        <hr className="border-foreground/20" />
      </div>
      {version.erased ? (
        <p data-testid="version-erased" className="rounded border border-foreground/20 p-3">
          {t("erasedNotice")}
        </p>
      ) : (
        <DocumentArticle
          document={version.document}
          locale={locale}
          uiLocale={uiLocale}
          emptyLabel={t("documentEmpty")}
        />
      )}
    </>
  );
}
