import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { VerifiedInstitutionBadge } from "@/components/catalogue/resource-card";
import { ResourceSummary } from "@/components/catalogue/resource-summary";
import { Link } from "@/i18n/navigation";
import { getCurrentUser, hasSessionCookie } from "@/lib/auth/session";
import { reportResource } from "@/lib/catalogue/actions";
import { isPublicPageAllowed } from "@/lib/catalogue/public-guard";
import { openGraphLocale, publicPageAlternates, publicPageUrl } from "@/lib/catalogue/public-metadata";
import { getPublicResource } from "@/lib/catalogue/public-queries";
import {
  resourceDescription,
  resourceJsonLd,
  serializeJsonLd,
  type PublicResource,
} from "@/lib/catalogue/public-resource";
import { getResource } from "@/lib/catalogue/queries";
import { REPORT_REASONS } from "@/lib/catalogue/schemas";
import { setCollectionItem, setFavorite } from "@/lib/library/actions";
import { recordResourceView } from "@/lib/library/history";
import { getCollectionIdsContaining, getCollections, isFavorite } from "@/lib/library/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProjects } from "@/lib/projects/queries";
import { addSourceFromResource } from "@/lib/projects/source-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/resources/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  // Les métadonnées viennent de la seule lecture publique : une fiche non
  // publiée ou réservée n'y laisse ni son titre ni son résumé, même pour un
  // compte qui a le droit de la lire.
  // Sans compte, la limite par adresse vaut aussi pour cette lecture.
  const allowed = (await hasSessionCookie()) || (await isPublicPageAllowed());
  const resource = allowed ? await getPublicResource(id) : null;
  if (!resource) {
    const t = await getTranslations("Catalogue.resource");
    return { title: t("title"), robots: { index: false } };
  }

  const path = `/resources/${resource.id}`;
  const description = resourceDescription(resource);
  return {
    title: resource.title,
    description,
    alternates: publicPageAlternates(locale, path),
    openGraph: {
      type: "article",
      title: resource.title,
      description,
      url: publicPageUrl(locale, path),
      locale: openGraphLocale(locale),
      ...(resource.authors.length > 0 ? { authors: resource.authors.slice(0, 10) } : {}),
    },
    robots: { index: true, follow: true },
  };
}

const LIBRARY_NOTICES = {
  "favorite-added": "favoriteAdded",
  "favorite-removed": "favoriteRemoved",
  "item-added": "itemAdded",
  "item-removed": "itemRemoved",
} as const;

export default async function ResourcePage(props: PageProps<"/[locale]/resources/[id]">) {
  // Sans session : la fiche publique (ADR-0014). Avec une session, la fiche
  // des comptes et ses actions.
  if (!(await getCurrentUser())) return <PublicResourcePage {...props} />;
  return <AccountResourcePage {...props} />;
}

async function PublicResourcePage({ params }: PageProps<"/[locale]/resources/[id]">) {
  const { locale, id } = await params;
  if (!(await isPublicPageAllowed())) {
    const t = await getTranslations("Catalogue.resource");
    return (
      <AuthPageShell wide title={t("title")}>
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("rateLimited")}
        </p>
      </AuthPageShell>
    );
  }
  const resource = await getPublicResource(id);
  if (!resource) notFound();

  const [t, tSearch, nonce] = await Promise.all([
    getTranslations("Catalogue.resource"),
    getTranslations("Catalogue.search"),
    headers().then((list) => list.get("x-nonce") ?? undefined),
  ]);

  return (
    <AuthPageShell
      wide
      title={resource.title}
      footer={
        <p className="flex flex-wrap gap-4">
          <Link href="/search" className="underline underline-offset-4">
            {t("backToSearch")}
          </Link>
          <Link href="/" className="underline underline-offset-4">
            {t("backToHome")}
          </Link>
        </p>
      }
    >
      <JsonLd resource={resource} url={publicPageUrl(locale, `/resources/${resource.id}`)} nonce={nonce} />
      {resource.verifiedInstitution ? (
        <VerifiedInstitutionBadge label={tSearch("verifiedInstitution")} />
      ) : null}
      <ResourceSummary resource={resource} />
      <p className="text-sm opacity-70">{t("externalNotice")}</p>

      <section aria-labelledby="sign-in-heading" className="flex flex-col gap-3">
        <h2 id="sign-in-heading" className="text-lg font-semibold">
          {t("signInHeading")}
        </h2>
        <p className="text-sm opacity-80">{t("signInIntro")}</p>
        <p>
          <Link
            href={{ pathname: "/sign-in", query: { next: `/resources/${resource.id}` } }}
            className="underline underline-offset-4"
          >
            {t("signIn")}
          </Link>
        </p>
      </section>
    </AuthPageShell>
  );
}

/**
 * Données structurées de la fiche. Le contenu n'est pas exécuté ; il porte
 * tout de même le nonce de la CSP, et « < » y est échappé.
 */
function JsonLd({ resource, url, nonce }: { resource: PublicResource; url: string; nonce?: string }) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // Exception unique à M-17 : un enfant texte serait échappé en entités HTML,
      // que l'élément <script> ne décode pas. Le JSON est sérialisé par
      // serializeJsonLd, qui échappe <, > et & (testé).
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(resourceJsonLd(resource, url)) }}
    />
  );
}

async function AccountResourcePage({
  params,
  searchParams,
}: PageProps<"/[locale]/resources/[id]">) {
  const { id } = await params;
  await requireOnboardedUser(`/resources/${id}`);

  // Seules les fiches publiées se consultent ici. Une proposition en cours se
  // suit dans « Mes contributions », une fiche à modérer dans la modération.
  const resource = await getResource(id);
  if (!resource || resource.editorialStatus !== "published" || resource.visibility !== "public") {
    notFound();
  }
  // Historique personnel : compte connecté seulement (cette branche exige la session).
  await recordResourceView(resource.id);

  const [t, tReason, tLibrary, tSources, favorite, collections, containing, projects, { notice }] =
    await Promise.all([
      getTranslations("Catalogue.resource"),
      getTranslations("Catalogue.reportReason"),
      getTranslations("Library"),
      getTranslations("Projects.sources"),
      isFavorite(resource.id),
      getCollections(),
      getCollectionIdsContaining(resource.id),
      getProjects(),
      searchParams,
    ]);
  const libraryNotice =
    typeof notice === "string" && Object.hasOwn(LIBRARY_NOTICES, notice)
      ? LIBRARY_NOTICES[notice as keyof typeof LIBRARY_NOTICES]
      : null;
  const available = collections.filter((collection) => !containing.has(collection.id));
  const holding = collections.filter((collection) => containing.has(collection.id));

  return (
    <AuthPageShell
      wide
      title={resource.title}
      footer={
        <p>
          <Link href="/search" className="underline underline-offset-4">
            {t("backToSearch")}
          </Link>
        </p>
      }
    >
      {notice === "reported" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("reported")}
        </p>
      ) : null}

      {libraryNotice ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {tLibrary(libraryNotice)}
        </p>
      ) : null}

      <ResourceSummary resource={resource} />
      <p className="text-sm opacity-70">{t("externalNotice")}</p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{tLibrary("saveHeading")}</h2>
        <p data-testid="favorite-state" className="text-sm opacity-80">
          {favorite ? tLibrary("isFavorite") : tLibrary("notFavorite")}
        </p>
        <AuthForm
          action={setFavorite}
          submitLabel={favorite ? tLibrary("removeFavorite") : tLibrary("addFavorite")}
          pendingLabel={tLibrary("pending")}
        >
          <input type="hidden" name="resourceId" value={resource.id} />
          <input type="hidden" name="present" value={favorite ? "false" : "true"} />
        </AuthForm>

        {holding.length > 0 ? (
          <p className="text-sm">
            <span>{tLibrary("inCollections")}</span>
            {holding.map((collection, index) => (
              <span key={collection.id}>
                {index > 0 ? tLibrary("listSeparator") : null}
                <Link
                  href={`/library/collections/${collection.id}`}
                  className="underline underline-offset-4"
                >
                  {collection.name}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
        {available.length > 0 ? (
          <AuthForm
            action={setCollectionItem}
            submitLabel={tLibrary("addToCollection")}
            pendingLabel={tLibrary("pending")}
          >
            <input type="hidden" name="resourceId" value={resource.id} />
            <input type="hidden" name="present" value="true" />
            <SelectField
              name="collectionId"
              label={tLibrary("collection")}
              placeholder={tLibrary("choose")}
              options={available.map(({ id, name }) => ({ value: id, label: name }))}
              required
            />
          </AuthForm>
        ) : null}
        <p className="text-sm">
          <Link href="/library" className="underline underline-offset-4">
            {tLibrary("manage")}
          </Link>
        </p>
      </section>

      {projects.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{tSources("citeHeading")}</h2>
          <p className="text-sm opacity-80">{tSources("citeIntro")}</p>
          <AuthForm
            action={addSourceFromResource}
            submitLabel={tSources("cite")}
            pendingLabel={tSources("pending")}
          >
            <input type="hidden" name="resourceId" value={resource.id} />
            <SelectField
              name="projectId"
              label={tSources("project")}
              placeholder={tSources("fields.choose")}
              options={projects.map(({ id: value, title }) => ({ value, label: title }))}
              defaultValue={projects.length === 1 ? projects[0]?.id : undefined}
              required
            />
          </AuthForm>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("reportHeading")}</h2>
        <p className="text-sm opacity-80">{t("reportIntro")}</p>
        <AuthForm action={reportResource} submitLabel={t("reportSubmit")} pendingLabel={t("pending")}>
          <input type="hidden" name="resourceId" value={resource.id} />
          <SelectField
            name="reason"
            label={t("reportReason")}
            placeholder={t("choose")}
            options={REPORT_REASONS.map((reason) => ({ value: reason, label: tReason(reason) }))}
            required
          />
          <OptionalTextField name="details" label={t("reportDetails")} maxLength={2000} rows={3} />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
