import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Assisted } from "@/lib/assistance/queries";
import type { ClassificationSuggestion, SimilarResource } from "@/lib/assistance/schemas";
import { referenceLabel } from "@/lib/reference/data";

type ModerationAssistanceProps = {
  similar: Assisted<SimilarResource>;
  suggestions: Assisted<ClassificationSuggestion>;
  locale: string;
  /** Ancre du formulaire de correction, s'il est proposé pour cette fiche. */
  correctionAnchor: string | null;
};

const NOTE = "rounded border border-foreground/30 p-3 text-sm";

/**
 * Aide au modérateur : fiches qui ressemblent à celle-ci, matières possibles.
 * Des suggestions calculées, avec ce qui les justifie ; rien n'est appliqué
 * ici — la personne décide, par les formulaires de la page.
 */
export async function ModerationAssistance({
  similar,
  suggestions,
  locale,
  correctionAnchor,
}: ModerationAssistanceProps) {
  const [t, tStatus] = await Promise.all([
    getTranslations("Assistance.moderation"),
    getTranslations("Catalogue.editorialStatus"),
  ]);
  const unavailable = (state: Assisted<unknown>) =>
    state.status === "rate_limited" ? t("rateLimited") : t("unavailable");

  return (
    <section className="flex flex-col gap-4" data-testid="moderation-assistance">
      <h2 className="text-lg font-semibold">{t("heading")}</h2>
      <p className={NOTE}>{t("disclaimer")}</p>

      <div className="flex flex-col gap-2" data-testid="similar-resources">
        <h3 className="font-medium">{t("similarHeading")}</h3>
        {similar.status !== "ok" ? (
          <p role="status" className="text-sm">
            {unavailable(similar)}
          </p>
        ) : similar.items.length === 0 ? (
          <p className="text-sm opacity-70">{t("similarEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {similar.items.map((item) => (
              <li
                key={item.id}
                data-testid="similar-resource"
                className="flex flex-col gap-1 rounded border border-foreground/20 p-3 text-sm"
              >
                <Link href={`/moderation/${item.id}`} className="font-medium underline underline-offset-4">
                  {item.title}
                </Link>
                <p>
                  {[
                    Object.hasOwn(STATUSES, item.editorialStatus)
                      ? tStatus(item.editorialStatus as "pending")
                      : item.editorialStatus,
                    t(`reasons.${item.reason}`),
                    t(`confidence.${item.confidence}`),
                  ].join(t("separator"))}
                </p>
                {item.reason === "similar_title" ? (
                  <p className="opacity-80">{t("titleScore", { percent: Math.round(item.score * 100) })}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2" data-testid="suggested-subjects">
        <h3 className="font-medium">{t("subjectsHeading")}</h3>
        {suggestions.status !== "ok" ? (
          <p role="status" className="text-sm">
            {unavailable(suggestions)}
          </p>
        ) : suggestions.items.length === 0 ? (
          <p className="text-sm opacity-70">{t("subjectsEmpty")}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {suggestions.items.map((item) => (
                <li
                  key={item.code}
                  data-testid="suggested-subject"
                  className="flex flex-col gap-1 rounded border border-foreground/20 p-3 text-sm"
                >
                  <p className="font-medium">{referenceLabel(item.labels, locale) || item.code}</p>
                  <p>
                    {[
                      t("matchedWords", { count: item.matchedWords.length, words: item.matchedWords.join(", ") }),
                      t(`confidence.${item.confidence}`),
                    ].join(t("separator"))}
                  </p>
                </li>
              ))}
            </ul>
            {correctionAnchor ? (
              <p className="text-sm">
                {t("applyHint")}{" "}
                <a href={`#${correctionAnchor}`} className="inline-block py-2 underline underline-offset-4">
                  {t("toCorrection")}
                </a>
              </p>
            ) : (
              <p className="text-sm opacity-80">{t("notEditable")}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// Statuts éditoriaux connus des messages ; tout autre est affiché tel quel.
const STATUSES = {
  pending: true,
  under_review: true,
  changes_requested: true,
  verified: true,
  published: true,
  rejected: true,
  suspended: true,
  removed: true,
} as const;
