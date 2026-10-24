import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicSearchForm } from "@/components/catalogue/public-search";
import { ResourceCard } from "@/components/catalogue/resource-card";
import { Link } from "@/i18n/navigation";
import { hasSessionCookie } from "@/lib/auth/session";
import { openGraphLocale, publicPageAlternates, publicPageUrl } from "@/lib/catalogue/public-metadata";
import { isPublicPageAllowed } from "@/lib/catalogue/public-guard";
import { getPublicSearchOptions } from "@/lib/catalogue/public-options";
import { getHomeSections } from "@/lib/catalogue/public-queries";
import type { PublicResource } from "@/lib/catalogue/public-resource";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations("Metadata");
  return {
    description: t("description"),
    alternates: publicPageAlternates(locale, "/"),
    openGraph: {
      type: "website",
      siteName: t("title"),
      title: t("title"),
      description: t("description"),
      url: publicPageUrl(locale, "/"),
      locale: openGraphLocale(locale),
    },
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  // Simple choix d'affichage : la recherche des comptes ne filtre ni par pays
  // ni par filière. Ce n'est pas un contrôle d'accès.
  const signedIn = await hasSessionCookie();
  // Sans compte, une limite large par adresse (ADR-0014) borne la lecture des
  // sections ; atteinte, l'accueil s'affiche sans elles.
  const allowed = signedIn || (await isPublicPageAllowed());
  const [t, sections, { options }] = await Promise.all([
    getTranslations("Home"),
    allowed ? getHomeSections() : Promise.resolve(null),
    getPublicSearchOptions(locale),
  ]);
  const typeLabel = (code: string) => options.types.find((item) => item.code === code)?.label ?? code;

  const list = (resources: PublicResource[], testId: string) =>
    resources.length === 0 ? (
      <p className="opacity-70">{t("empty")}</p>
    ) : (
      <ul data-testid={testId} className="grid gap-3 md:grid-cols-2">
        {resources.map((resource) => (
          <ResourceCard key={resource.id} resource={resource} typeLabel={typeLabel(resource.typeCode)} />
        ))}
      </ul>
    );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 py-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="text-lg">{t("tagline")}</p>
        <p className="opacity-80">{t("intro")}</p>
      </section>

      <section aria-labelledby="home-search-heading" className="flex flex-col gap-4">
        <h2 id="home-search-heading" className="text-xl font-semibold">
          {t("searchHeading")}
        </h2>
        <PublicSearchForm
          action={`/${locale}/search`}
          filters={null}
          options={options}
          compact
          idPrefix="home-"
          omit={signedIn ? ["country", "program"] : []}
        />
      </section>

      {sections === null ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("rateLimited")}
        </p>
      ) : null}

      {sections && sections.institutional.length > 0 ? (
        <section aria-labelledby="home-institutional-heading" className="flex flex-col gap-3">
          <h2 id="home-institutional-heading" className="text-xl font-semibold">
            {t("institutionalHeading")}
          </h2>
          <p className="text-sm opacity-80">{t("institutionalNote")}</p>
          {list(sections.institutional, "home-institutional")}
        </section>
      ) : null}

      {sections ? (
        <section aria-labelledby="home-recent-heading" className="flex flex-col gap-3">
          <h2 id="home-recent-heading" className="text-xl font-semibold">
            {t("recentHeading")}
          </h2>
          {list(sections.recent, "home-recent")}
        </section>
      ) : null}

      {sections && sections.popular.length > 0 ? (
        <section aria-labelledby="home-popular-heading" className="flex flex-col gap-3">
          <h2 id="home-popular-heading" className="text-xl font-semibold">
            {t("popularHeading")}
          </h2>
          <p className="text-sm opacity-80">{t("popularNote")}</p>
          {list(sections.popular, "home-popular")}
        </section>
      ) : null}

      {signedIn ? null : (
        <section aria-labelledby="home-account-heading" className="flex flex-col gap-3">
          <h2 id="home-account-heading" className="text-xl font-semibold">
            {t("accountHeading")}
          </h2>
          <p className="opacity-80">{t("accountIntro")}</p>
          <p className="flex flex-wrap gap-4">
            <Link href="/sign-in" className="underline underline-offset-4">
              {t("signIn")}
            </Link>
            <Link href="/sign-up" className="underline underline-offset-4">
              {t("signUp")}
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
