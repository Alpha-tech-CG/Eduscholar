import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { SavedList } from "@/components/library/saved-list";
import { Link } from "@/i18n/navigation";
import { createCollection, setFavorite } from "@/lib/library/actions";
import { getCollections, getFavorites, parsePage } from "@/lib/library/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Library");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  "favorite-removed": "favoriteRemoved",
  "favorite-added": "favoriteAdded",
  deleted: "collectionDeleted",
} as const;

export default async function LibraryPage({ searchParams }: PageProps<"/[locale]/library">) {
  await requireOnboardedUser("/library");
  const { notice, page } = await searchParams;
  const [t, favorites, collections] = await Promise.all([
    getTranslations("Library"),
    getFavorites(parsePage(page)),
    getCollections(),
  ]);
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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("favorites", { count: favorites.total })}</h2>
        <SavedList
          saved={favorites}
          emptyLabel={t("favoritesEmpty")}
          pathname="/library"
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
