import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthPageShell } from "@/components/auth/page-shell";
import { PublicSearchForm, PublicSearchResults } from "@/components/catalogue/public-search";
import { ResourceCard } from "@/components/catalogue/resource-card";
import { Link } from "@/i18n/navigation";
import { checkAttempt } from "@/lib/auth/rate-limit";
import { getCurrentUser } from "@/lib/auth/session";
import { getPublicSearchOptions } from "@/lib/catalogue/public-options";
import { searchPublicResources } from "@/lib/catalogue/public-queries";
import { getCatalogueReference, searchResources } from "@/lib/catalogue/queries";
import {
  parsePublicSearchParams,
  parseSearchParams,
  SEARCH_PAGE_SIZE,
  SEARCHABLE_ACCESS_STATUSES,
  toSearchParams,
} from "@/lib/catalogue/search";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getReferenceData } from "@/lib/profile/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.search");
  return { title: t("title"), robots: { index: false } };
}

const field = "rounded border border-foreground/30 bg-background px-3 py-2";

export default async function SearchPage(props: PageProps<"/[locale]/search">) {
  // Sans session : la recherche publique (ADR-0014). Avec une session, même
  // incomplète, la recherche des comptes et ses redirections.
  if (!(await getCurrentUser())) return <PublicSearchPage {...props} />;
  return <AccountSearchPage {...props} />;
}

async function PublicSearchPage({ params, searchParams }: PageProps<"/[locale]/search">) {
  const { locale } = await params;
  const [t, { options, reference }, raw] = await Promise.all([
    getTranslations("Catalogue.search"),
    getPublicSearchOptions(locale),
    searchParams,
  ]);
  const filters = parsePublicSearchParams(raw, reference);
  // Limite par adresse, avant toute lecture : refus et panne du compteur
  // donnent le même message.
  const allowed = (await checkAttempt("public-search")) === "allowed";
  const result = allowed
    ? await searchPublicResources(filters)
    : { resources: [], total: 0, capped: false, failed: false };
  const typeLabel = (code: string) => options.types.find((item) => item.code === code)?.label ?? code;

  return (
    <AuthPageShell wide title={t("title")} intro={t("publicIntro")}>
      <PublicSearchForm action={`/${locale}/search`} filters={filters} options={options} />
      <PublicSearchResults filters={filters} result={result} limited={!allowed} typeLabel={typeLabel} />
      <p className="text-sm">
        <Link href={{ pathname: "/sign-in", query: { next: "/search" } }} className="underline underline-offset-4">
          {t("publicNotice")}
        </Link>
      </p>
    </AuthPageShell>
  );
}

async function AccountSearchPage({ searchParams }: PageProps<"/[locale]/search">) {
  const { user, profile } = await requireOnboardedUser("/search");
  const locale = await getLocale();
  const [t, tAccess, reference, catalogue, params] = await Promise.all([
    getTranslations("Catalogue.search"),
    getTranslations("Catalogue.accessStatus"),
    getReferenceData(locale),
    getCatalogueReference(locale),
    searchParams,
  ]);

  // Matières de la filière de l'utilisateur.
  const subjects = reference.subjects.filter((item) => item.programCode === profile.programCode);
  const filters = parseSearchParams(params, {
    types: catalogue.types.map(({ code }) => code),
    languages: catalogue.languages.map(({ code }) => code),
    levels: reference.levels.map(({ code }) => code),
    subjects: subjects.map(({ code }) => code),
  });

  const result =
    (await checkAttempt("search", user.id)) === "allowed"
      ? await searchResources(filters)
      : { resources: [], total: 0, capped: false, failed: false, limited: true };
  const { resources, total, capped, failed } = result;
  // Refus de l'application ou de la base : le même message.
  const allowed = !result.limited;
  const lastPage = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  const typeLabel = (code: string) =>
    catalogue.types.find((item) => item.code === code)?.label ?? code;

  const selects: Array<{
    name: string;
    label: string;
    value: string | null;
    options: { code: string; label: string }[];
  }> = [
    { name: "type", label: t("type"), value: filters.typeCode, options: catalogue.types },
    {
      name: "language",
      label: t("language"),
      value: filters.languageCode,
      options: catalogue.languages,
    },
    {
      name: "access",
      label: t("access"),
      value: filters.accessStatus,
      options: SEARCHABLE_ACCESS_STATUSES.map((code) => ({ code, label: tAccess(code) })),
    },
    { name: "level", label: t("level"), value: filters.levelCode, options: reference.levels },
    { name: "subject", label: t("subject"), value: filters.subjectCode, options: subjects },
  ];

  return (
    <AuthPageShell wide title={t("title")} intro={t("intro")}>
      {/* Formulaire en GET : l'adresse d'une recherche se partage et se retrouve. */}
      <form method="get" role="search" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="font-medium">
            {t("query")}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.query}
            maxLength={200}
            autoComplete="off"
            className={field}
          />
          <p className="text-sm opacity-70">{t("queryHint")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {selects.map(({ name, label, value, options }) => (
            <div key={name} className="flex flex-col gap-1">
              <label htmlFor={name} className="font-medium">
                {label}
              </label>
              <select id={name} name={name} defaultValue={value ?? ""} className={field}>
                <option value="">{t("any")}</option>
                {options.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="rounded bg-foreground px-4 py-3 font-medium text-background"
          >
            {t("submit")}
          </button>
          <Link href="/search" className="underline underline-offset-4">
            {t("reset")}
          </Link>
          <Link href="/recommendations" className="underline underline-offset-4">
            {t("toRecommendations")}
          </Link>
        </div>
      </form>

      <section aria-labelledby="results-heading" className="flex flex-col gap-3">
        <h2 id="results-heading" className="text-lg font-semibold">
          {!allowed || failed
            ? t("resultsHeading")
            : capped
              ? t("resultsCapped", { count: total })
              : t("results", { count: total })}
        </h2>
        {!allowed ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {t("rateLimited")}
          </p>
        ) : failed ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
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

      {lastPage > 1 ? (
        <nav aria-label={t("pagination")} className="flex items-center justify-between gap-4">
          {filters.page > 1 ? (
            <Link
              href={{ pathname: "/search", query: toSearchParams(filters, filters.page - 1) }}
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
              href={{ pathname: "/search", query: toSearchParams(filters, filters.page + 1) }}
              className="underline underline-offset-4"
            >
              {t("next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </AuthPageShell>
  );
}
