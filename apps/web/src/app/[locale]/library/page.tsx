import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { ItemDetails } from "@/components/library/item-details";
import { LibraryExportLinks } from "@/components/library/export-links";
import { SavedList } from "@/components/library/saved-list";
import { Link } from "@/i18n/navigation";
import { createCollection, setFavorite } from "@/lib/library/actions";
import { getCollections, getFavorites, getLibraryTags, parsePage } from "@/lib/library/queries";
import { parseTag } from "@/lib/library/schemas";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Library");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  "favorite-removed": "favoriteRemoved",
  "favorite-added": "favoriteAdded",
  deleted: "collectionDeleted",
  "note-saved": "noteSaved",
  "tag-added": "tagAdded",
  "tag-removed": "tagRemoved",
} as const;

export default async function LibraryPage({ searchParams }: PageProps<"/[locale]/library">) {
  await requireOnboardedUser("/library");
  const { notice, page, tag } = await searchParams;
  const [t, tags, collections, locale] = await Promise.all([
    getTranslations("Library"),
    getLibraryTags(),
    getCollections(),
    getLocale(),
  ]);
  // Le filtre ne retient qu'un tag de l'utilisateur, sous sa graphie enregistrée.
  const wanted = parseTag(tag)?.toLocaleLowerCase();
  const activeTag = wanted ? (tags.find((item) => item.tag.toLocaleLowerCase() === wanted)?.tag ?? null) : null;
  const favorites =
    wanted && activeTag === null
      ? { resources: [], unavailableIds: [], notes: {}, tags: {}, total: 0, page: 1, lastPage: 1, failed: false }
      : await getFavorites(parsePage(page), activeTag);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/search" className="underline underline-offset-4">
            {t("toSearch")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      <p>
        <Link href="/library/history" className="underline underline-offset-4">
          {t("toHistory")}
        </Link>
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("favorites", { count: favorites.total })}</h2>
        {tags.length > 0 ? (
          <nav aria-label={t("tagFilter")} className="flex flex-col gap-2 text-sm">
            <p>{t("tagFilter")}</p>
            <ul className="flex flex-wrap gap-2">
              <li>
                {activeTag === null && !wanted ? (
                  <span aria-current="true" className="rounded bg-foreground px-2 py-0.5 text-background">
                    {t("allFavorites")}
                  </span>
                ) : (
                  <Link href="/library" className="rounded border border-foreground/30 px-2 py-0.5">
                    {t("allFavorites")}
                  </Link>
                )}
              </li>
              {tags.map((item) => (
                <li key={item.tag}>
                  {item.tag === activeTag ? (
                    <span aria-current="true" className="rounded bg-foreground px-2 py-0.5 text-background">
                      {t("tagWithCount", { tag: item.tag, count: item.count })}
                    </span>
                  ) : (
                    <Link
                      href={{ pathname: "/library", query: { tag: item.tag } }}
                      className="rounded border border-foreground/30 px-2 py-0.5"
                    >
                      {t("tagWithCount", { tag: item.tag, count: item.count })}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {favorites.total > 0 && activeTag === null ? (
          <LibraryExportLinks label={t("exportFavorites")} locale={locale} />
        ) : null}
        <SavedList
          saved={favorites}
          emptyLabel={wanted ? t("tagEmpty") : t("favoritesEmpty")}
          pathname="/library"
          query={activeTag ? { tag: activeTag } : {}}
          details={(resourceId) => (
            <ItemDetails
              resourceId={resourceId}
              note={favorites.notes[resourceId] ?? null}
              tags={favorites.tags[resourceId] ?? []}
              returnTag={activeTag}
            />
          )}
          removeForm={(resourceId) => (
            <AuthForm
              action={setFavorite}
              submitLabel={t("removeFavorite")}
              pendingLabel={t("pending")}
            >
              <input type="hidden" name="resourceId" value={resourceId} />
              <input type="hidden" name="present" value="false" />
              <input type="hidden" name="from" value="library" />
            </AuthForm>
          )}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("collections", { count: collections.length })}</h2>
        {collections.length === 0 ? (
          <p className="opacity-70">{t("collectionsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {collections.map((collection) => (
              <li key={collection.id} className="rounded border border-foreground/20 p-3">
                <Link
                  href={`/library/collections/${collection.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {collection.name}
                </Link>
                <p className="text-sm opacity-80">
                  {t("itemCount", { count: collection.itemCount })}
                </p>
                {collection.description ? (
                  <p className="text-sm whitespace-pre-line">{collection.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("newCollection")}</h2>
        <AuthForm action={createCollection} submitLabel={t("create")} pendingLabel={t("pending")}>
          <OptionalTextField name="name" label={t("name")} maxLength={120} required />
          <OptionalTextField
            name="description"
            label={t("description")}
            maxLength={1000}
            rows={2}
          />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
