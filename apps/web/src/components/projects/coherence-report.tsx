import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import {
  groupFindings,
  knownSourceFields,
  PROJECT_FIELD_KEYS,
  reportLinks,
  type CoherenceFinding,
  type CoherenceReport as Report,
  type ReportScope,
} from "@/lib/assistance/schemas";

type CoherenceReportProps = {
  report: Report;
  projectId: string;
  scope: ReportScope;
  /** Titres des sources, par identifiant : connus du seul propriétaire. */
  sourceTitles?: Map<string, string>;
  /** Titres des sections, par identifiant, quand la page les a lus. */
  sectionTitles?: Map<string, string>;
};

const LINK = "underline underline-offset-4";

/**
 * Rapport de cohérence d'un projet, par familles. Des contrôles automatiques
 * de forme : chaque constat dit ce qu'il a compté et mène à ce qu'il désigne.
 * Rien n'est corrigé ici.
 */
export async function CoherenceReport({
  report,
  projectId,
  scope,
  sourceTitles = new Map(),
  sectionTitles = new Map(),
}: CoherenceReportProps) {
  const [t, tFields] = await Promise.all([
    getTranslations("Assistance.coherence"),
    getTranslations("Projects.fields"),
  ]);
  const links = reportLinks(scope, projectId);
  const groups = groupFindings(report.findings);

  const linked = (href: string | null, label: string) =>
    href ? (
      <Link href={href} className={LINK}>
        {label}
      </Link>
    ) : (
      label
    );
  const sectionList = (sections: { id: string; title: string }[]) => (
    <ul className="list-disc ps-5">
      {sections.map((section) => (
        <li key={section.id}>{linked(links.section(section.id), section.title || t("untitledSection"))}</li>
      ))}
    </ul>
  );
  // Les titres des sources ne sont connus que du propriétaire : sans eux, le nombre suffit.
  const sourceList = (ids: string[], detail?: (id: string) => string | null) =>
    sourceTitles.size === 0 ? null : (
      <ul className="list-disc ps-5">
        {ids.map((id) => {
          const extra = detail?.(id);
          return (
            <li key={id}>
              {linked(links.source(id), sourceTitles.get(id) || t("untitledSource"))}
              {extra ? (
                <span className="opacity-80">
                  {t("separator")}
                  {extra}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );

  const details = (finding: CoherenceFinding): ReactNode => {
    switch (finding.code) {
      case "project_incomplete": {
        const names = finding.fields.flatMap((field) =>
          Object.hasOwn(PROJECT_FIELD_KEYS, field)
            ? [tFields(PROJECT_FIELD_KEYS[field as keyof typeof PROJECT_FIELD_KEYS])]
            : [],
        );
        return (
          <>
            {names.length > 0 ? <p>{t("fieldsMissing", { fields: names.join(", ") })}</p> : null}
            {links.edit ? <p>{linked(links.edit, t("toEdit"))}</p> : null}
          </>
        );
      }
      case "task_overdue":
        return <p>{linked(links.tasks, t("toTasks"))}</p>;
      case "section_empty":
      case "section_without_citation":
      case "section_single_source":
      case "section_short":
        return sectionList(finding.sections);
      case "source_never_cited":
      case "cited_source_without_note":
        return sourceList(finding.source_ids);
      case "source_incomplete":
        return sourceList(
          finding.sources.map((source) => source.id),
          (id) => {
            const missing = knownSourceFields(finding.sources.find((source) => source.id === id)?.missing ?? []);
            return missing.length > 0
              ? t("sourceMissing", { fields: missing.map((field) => t(`sourceFields.${field}`)).join(", ") })
              : null;
          },
        );
      case "source_duplicate":
        return sourceTitles.size === 0 ? null : (
          <ul className="flex flex-col gap-2">
            {finding.groups.map((group) => (
              <li key={group.join("-")}>{sourceList(group)}</li>
            ))}
          </ul>
        );
      case "citation_without_pages": {
        const sectionIds = [...new Set(finding.citations.map((citation) => citation.section_id))];
        return (
          <ul className="list-disc ps-5">
            {sectionIds.map((id, index) => (
              <li key={id}>
                {linked(links.section(id), sectionTitles.get(id) || t("sectionNumber", { number: index + 1 }))}
                <span className="opacity-80">
                  {t("separator")}
                  {t("citationsHere", {
                    count: finding.citations.filter((citation) => citation.section_id === id).length,
                  })}
                </span>
              </li>
            ))}
          </ul>
        );
      }
      default:
        return null;
    }
  };

  const text = (finding: CoherenceFinding): string => {
    switch (finding.code) {
      case "project_overdue":
        return t("findings.project_overdue", { days: finding.days_late });
      case "project_due_soon":
        return t("findings.project_due_soon", { days: finding.days_left });
      case "literature_none_recent":
        return t("findings.literature_none_recent", { year: finding.newest_year });
      case "literature_mostly_old":
        return t("findings.literature_mostly_old", { count: finding.count, total: finding.sources_with_year });
      default:
        return t(`findings.${finding.code}`, { count: finding.count });
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="coherence-report">
      <p className="rounded border border-foreground/30 p-3 text-sm" data-testid="coherence-disclaimer">
        {t("disclaimer")}
      </p>

      <p className="text-sm opacity-80" data-testid="coherence-totals">
        {t("totals", {
          sections: report.totals.sections,
          sources: report.totals.sources,
          citations: report.totals.citations,
          tasks: report.totals.tasks,
        })}
      </p>

      {groups.length === 0 ? (
        <p data-testid="coherence-clear">{t("clear")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.family} className="flex flex-col gap-3" data-testid={`family-${group.family}`}>
            <h2 className="text-lg font-semibold">{t(`families.${group.family}`)}</h2>
            <ul className="flex flex-col gap-3">
              {group.findings.map((finding, index) => (
                <li
                  key={`${finding.code}-${index}`}
                  data-testid="finding"
                  data-code={finding.code}
                  className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
                >
                  <p>
                    <span className="me-2 rounded border border-foreground/40 px-2 py-0.5 text-sm font-medium">
                      {t(`severity.${finding.severity}`)}
                    </span>
                    {text(finding)}
                  </p>
                  <p className="text-sm opacity-80">{t(`help.${finding.code}`)}</p>
                  <div className="flex flex-col gap-2 text-sm">{details(finding)}</div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {report.unreadable > 0 ? (
        <p role="status" className="text-sm">
          {t("unreadable", { count: report.unreadable })}
        </p>
      ) : null}
    </div>
  );
}
