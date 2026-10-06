import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { ResourceSummary } from "@/components/catalogue/resource-summary";
import { Link } from "@/i18n/navigation";
import { reportResource } from "@/lib/catalogue/actions";
import { getResource } from "@/lib/catalogue/queries";
import { REPORT_REASONS } from "@/lib/catalogue/schemas";
import { setCollectionItem, setFavorite } from "@/lib/library/actions";
import { getCollectionIdsContaining, getCollections, isFavorite } from "@/lib/library/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProjects } from "@/lib/projects/queries";
import { addSourceFromResource } from "@/lib/projects/source-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.resource");
  // Le titre de la fiche n'est pas mis dans l'onglet avant d'avoir vérifié le
  // droit de la lire : la page s'en charge.
  return { title: t("title"), robots: { index: false } };
}

const LIBRARY_NOTICES = {
  "favorite-added": "favoriteAdded",
  "favorite-removed": "favoriteRemoved",
  "item-added": "itemAdded",
  "item-removed": "itemRemoved",
} as const;

export default async function ResourcePage({
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
