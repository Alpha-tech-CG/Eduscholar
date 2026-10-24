import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ResourceCard } from "@/components/catalogue/resource-card";
import type { PublicSearchResult } from "@/lib/catalogue/public-queries";
import {
  SEARCH_PAGE_SIZE,
  SEARCHABLE_ACCESS_STATUSES,
  toPublicSearchParams,
  type PublicSearchFilters,
} from "@/lib/catalogue/search";
import type { Option } from "@/lib/profile/queries";

const field = "w-full rounded border border-foreground/30 bg-background px-3 py-2";

export type PublicSearchOptions = {
  types: Option[];
  languages: Option[];
  levels: Option[];
  programs: Option[];
  countries: Option[];
};

type SelectSpec = { name: string; label: string; value: string | null; options: Option[] };

/**
 * Formulaire de la recherche sans compte. En GET : l'adresse d'une recherche
 * se partage. Les champs portent un libellé visible ; `idPrefix` garde les
 * identifiants uniques si le formulaire figure deux fois sur une page.
 */
export async function PublicSearchForm({
  action,
  filters,
  options,
  compact = false,
  idPrefix = "",
  omit = [],
}: {
  /** Adresse de la recherche, préfixe de langue compris. */
  action: string;
  filters: PublicSearchFilters | null;
  options: PublicSearchOptions;
  /** Accueil : mots, pays, niveau et filière seulement. */
  compact?: boolean;
  idPrefix?: string;
  /** Filtres à ne pas proposer : ceux que la recherche des comptes ne connaît pas. */
  omit?: readonly string[];
}) {
  const [t, tAccess] = await Promise.all([
    getTranslations("Catalogue.search"),
    getTranslations("Catalogue.accessStatus"),
  ]);

  const allSelects: SelectSpec[] = [
    { name: "country", label: t("country"), value: filters?.countryCode ?? null, options: options.countries },
    { name: "level", label: t("level"), value: filters?.levelCode ?? null, options: options.levels },
    { name: "program", label: t("program"), value: filters?.programCode ?? null, options: options.programs },
    ...(compact
      ? []
      : [
          { name: "type", label: t("type"), value: filters?.typeCode ?? null, options: options.types },
          {
            name: "language",
            label: t("language"),
            value: filters?.languageCode ?? null,
            options: options.languages,
          },
          {
            name: "access",
            label: t("access"),
            value: filters?.accessStatus ?? null,
            options: SEARCHABLE_ACCESS_STATUSES.map((code) => ({ code, label: tAccess(code) })),
          },
        ]),
  ];
  const selects = allSelects.filter(({ name }) => !omit.includes(name));
  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <form method="get" action={action} role="search" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={id("q")} className="font-medium">
          {t("query")}
        </label>
        <input
          id={id("q")}
          name="q"
          type="search"
          defaultValue={filters?.query ?? ""}
          maxLength={200}
          autoComplete="off"
          aria-describedby={id("q-hint")}
          className={field}
        />
        <p id={id("q-hint")} className="text-sm opacity-70">
          {t("queryHint")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {selects.map(({ name, label, value, options: choices }) => (
          <div key={name} className="flex min-w-0 flex-col gap-1">
            <label htmlFor={id(name)} className="font-medium">
              {label}
            </label>
            <select id={id(name)} name={name} defaultValue={value ?? ""} className={field}>
              <option value="">{t("any")}</option>
              {choices.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="min-h-11 rounded bg-foreground px-4 py-3 font-medium text-background">
          {t("submit")}
        </button>
        {compact ? null : (
          <Link href="/search" className="underline underline-offset-4">
            {t("reset")}
          </Link>
        )}
      </div>
    </form>
  );
}

/** Résultats de la recherche sans compte, avec la pagination. */
export async function PublicSearchResults({
  filters,
  result,
  limited,
  typeLabel,
}: {
  filters: PublicSearchFilters;
  result: PublicSearchResult;
  limited: boolean;
  typeLabel: (code: string) => string;
}) {
  const t = await getTranslations("Catalogue.search");
  const { resources, total, capped, failed } = result;
  const lastPage = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  const alert =
    "rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300";

  return (
    <>
      <section aria-labelledby="results-heading" className="flex flex-col gap-3">
        <h2 id="results-heading" className="text-lg font-semibold">
          {limited || failed
            ? t("resultsHeading")
            : capped
              ? t("resultsCapped", { count: total })
              : t("results", { count: total })}
        </h2>
        {limited ? (
          <p role="alert" className={alert}>
            {t("rateLimited")}
          </p>
        ) : failed ? (
          <p role="alert" className={alert}>
            {t("unavailable")}
          </p>
        ) : resources.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {resources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} typeLabel={typeLabel(resource.typeCode)} />
            ))}
          </ul>
        )}
      </section>

      {!limited && !failed && lastPage > 1 ? (
        <nav aria-label={t("pagination")} className="flex items-center justify-between gap-4">
          {filters.page > 1 ? (
            <Link
              href={{ pathname: "/search", query: toPublicSearchParams(filters, filters.page - 1) }}
              className="underline underline-offset-4"
            >
              {t("previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm opacity-70">
            {t("page", { page: Math.min(filters.page, lastPage), pages: lastPage })}
          </span>
          {filters.page < lastPage ? (
            <Link
              href={{ pathname: "/search", query: toPublicSearchParams(filters, filters.page + 1) }}
              className="underline underline-offset-4"
            >
              {t("next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
