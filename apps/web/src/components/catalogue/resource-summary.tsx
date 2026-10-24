import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { PublicResource } from "@/lib/catalogue/public-resource";
import { getCatalogueReference } from "@/lib/catalogue/queries";
import { getReferenceData } from "@/lib/profile/queries";

/** Ce que la fiche affiche : une fiche lue sous session ou une fiche publique. */
export type SummaryResource = Omit<
  PublicResource,
  "verifiedInstitution" | "publishedAt" | "updatedAt" | "sourceKind"
> & {
  /** Champs modifiés depuis l'import : lus sous session seulement. */
  editedFields?: string[];
};

type ResourceSummaryProps = { resource: SummaryResource };

/**
 * Fiche d'une ressource : description, classement, provenance, licence et
 * statut d'accès. Tout le contenu est rendu en texte ; le lien officiel n'est
 * affiché en lien que s'il commence par http ou https, ce que la base impose déjà.
 */
export async function ResourceSummary({ resource }: ResourceSummaryProps) {
  const locale = await getLocale();
  const [t, tAccess, format, reference, catalogue] = await Promise.all([
    getTranslations("Catalogue.summary"),
    getTranslations("Catalogue.accessStatus"),
    getFormatter(),
    getReferenceData(locale),
    getCatalogueReference(locale),
  ]);

  const labelOf = (items: { code: string; label: string }[], code: string | null) =>
    items.find((item) => item.code === code)?.label ?? code ?? "";
  const labelsOf = (items: { code: string; label: string }[], codes: string[]) =>
    codes.map((code) => labelOf(items, code)).join(", ");
  const subjects = reference.subjects.filter((item) => item.programCode === resource.programCode);
  const safeUrl =
    resource.officialUrl && /^https?:\/\//.test(resource.officialUrl) ? resource.officialUrl : null;

  const editedLabels: Record<string, string> = {
    title: t("editedFields.title"),
    authors: t("authors"),
    publication_year: t("year"),
    type_code: t("type"),
    language_code: t("language"),
    license_code: t("license"),
    official_url: t("officialUrl"),
  };
  const rows: Array<[string, string | null]> = [
    [t("type"), labelOf(catalogue.types, resource.typeCode)],
    [t("authors"), resource.authors.join(", ") || null],
    [t("institution"), resource.institutionName],
    [t("year"), resource.publicationYear?.toString() ?? null],
    [t("language"), labelOf(catalogue.languages, resource.languageCode)],
    [t("country"), resource.countryCode ? labelOf(reference.countries, resource.countryCode) : null],
    [t("program"), labelOf(reference.programs, resource.programCode)],
    [t("levels"), labelsOf(reference.levels, resource.levelCodes) || null],
    [t("subjects"), labelsOf(subjects, resource.subjectCodes) || null],
    [t("tags"), resource.tags.join(", ") || null],
    [t("doi"), resource.doi],
    [t("accessStatus"), tAccess(resource.accessStatus as "unknown")],
    [t("license"), labelOf(catalogue.licenses, resource.licenseCode)],
    [t("source"), resource.sourceName],
    // Ce que la plateforme a changé depuis l'import : la source ne le dit pas ainsi.
    [
      t("editedSinceImport"),
      (resource.editedFields ?? [])
        .flatMap((field) => (Object.hasOwn(editedLabels, field) ? [editedLabels[field]] : []))
        .join(", ") || null,
    ],
    [
      t("lastVerified"),
      resource.lastVerifiedAt
        ? format.dateTime(new Date(resource.lastVerifiedAt), { dateStyle: "long" })
        : null,
    ],
  ];

  return (
    <div className="flex flex-col gap-4">
      {resource.abstract ? <p className="whitespace-pre-line">{resource.abstract}</p> : null}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        {rows
          .filter(([, value]) => value)
          .map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-sm opacity-70">{term}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        <div className="contents">
          <dt className="text-sm opacity-70">{t("officialUrl")}</dt>
          <dd className="break-all">
            {safeUrl ? (
              <a
                href={safeUrl}
                rel="noopener noreferrer nofollow"
                target="_blank"
                className="underline underline-offset-4"
              >
                {safeUrl}
              </a>
            ) : (
              t("missing")
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
