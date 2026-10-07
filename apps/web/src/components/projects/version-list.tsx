import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { VersionSummary } from "@/lib/projects/version-queries";

// Liste des versions soumises d'un projet, avec la décision qui fait foi et
// son historique. Rendue par la page du propriétaire et par celle d'un membre.

type Props = {
  /** Adresse de la page d'une version, sans son identifiant. */
  basePath: string;
  versions: VersionSummary[];
};

export async function VersionList({ basePath, versions }: Props) {
  const [t, format] = await Promise.all([getTranslations("Versions"), getFormatter()]);
  const day = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "long", timeStyle: "short" });

  if (versions.length === 0) return <p className="opacity-70">{t("empty")}</p>;

  return (
    <ul className="flex flex-col gap-4">
      {versions.map((version) => {
        const latest = version.decisions.at(-1);
        return (
          <li
            key={version.id}
            data-testid="version"
            className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
          >
            <p>
              <Link href={`${basePath}/${version.id}`} className="font-medium underline underline-offset-4">
                {t("versionName", { number: version.number })}
                {version.label ? `${t("separator")}${version.label}` : ""}
              </Link>
            </p>
            <p className="text-sm opacity-80">
              {(version.erased
                ? [t("submittedOn", { date: day(version.createdAt) }), t("erasedBadge")]
                : [
                    t("submittedOn", { date: day(version.createdAt) }),
                    t("sections", { count: version.sectionCount }),
                    t("words", { count: version.wordCount }),
                  ]
              ).join(t("separator"))}
            </p>
            {version.note ? <p className="whitespace-pre-line">{version.note}</p> : null}
            <p className="font-medium" data-testid="version-status">
              {latest ? t(`decisions.${latest.decision}`) : t("awaiting")}
            </p>
            {version.decisions.length > 0 ? (
              <ol className="flex flex-col gap-2 border-s border-foreground/20 ps-4">
                {version.decisions.map((decision, index) => (
                  <li key={index} data-testid="decision" className="flex flex-col gap-1">
                    <p className="text-sm opacity-80">
                      {[
                        t(`decisions.${decision.decision}`),
                        decision.mine ? t("byYou") : (decision.decidedByEmail ?? t("bySupervisor")),
                        day(decision.decidedAt),
                      ].join(t("separator"))}
                    </p>
                    {decision.comment ? <p className="whitespace-pre-line">{decision.comment}</p> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
