import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { LibraryExportLinks } from "@/components/library/export-links";
import { ItemDetails } from "@/components/library/item-details";
import { SavedList } from "@/components/library/saved-list";
import { Link } from "@/i18n/navigation";
import { deleteCollection, setCollectionItem, updateCollection } from "@/lib/library/actions";
import { getCollection, parsePage } from "@/lib/library/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Library");
  return { title: t("collectionTitle"), robots: { index: false } };
}

const NOTICES = {
  created: "collectionCreated",
  updated: "collectionUpdated",
  "item-removed": "itemRemoved",
  "item-added": "itemAdded",
  "note-saved": "noteSaved",
} as const;

export default async function CollectionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/library/collections/[id]">) {
  const { id } = await params;
  await requireOnboardedUser(`/library/collections/${id}`);

  // La collection d'un autre et une collection inexistante répondent pareil.
  const { notice, page } = await searchParams;
  const found = await getCollection(id, parsePage(page));
  if (!found) notFound();
  const { collection, saved } = found;

  const [t, locale] = await Promise.all([getTranslations("Library"), getLocale()]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  return (
    <AuthPageShell
      wide
      title={collection.name}
      intro={collection.description ?? undefined}
      footer={
        <p>
          <Link href="/library" className="underline underline-offset-4">
            {t("backToLibrary")}
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
        <h2 className="text-lg font-semibold">{t("items", { count: saved.total })}</h2>
        {saved.total > 0 ? (
          <LibraryExportLinks label={t("exportCollection")} locale={locale} collectionId={collection.id} />
        ) : null}
        <SavedList
          saved={saved}
          emptyLabel={t("itemsEmpty")}
          pathname={`/library/collections/${collection.id}`}
          details={(resourceId) => (
            <ItemDetails
              resourceId={resourceId}
              note={saved.notes[resourceId] ?? null}
              collectionId={collection.id}
            />
          )}
          removeForm={(resourceId) => (
            <AuthForm
              action={setCollectionItem}
              submitLabel={t("removeItem")}
              pendingLabel={t("pending")}
            >
              <input type="hidden" name="collectionId" value={collection.id} />
              <input type="hidden" name="resourceId" value={resourceId} />
              <input type="hidden" name="present" value="false" />
              <input type="hidden" name="from" value="collection" />
            </AuthForm>
          )}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("edit")}</h2>
        <AuthForm action={updateCollection} submitLabel={t("save")} pendingLabel={t("pending")}>
          <input type="hidden" name="collectionId" value={collection.id} />
          <OptionalTextField
            name="name"
            label={t("name")}
            maxLength={120}
            defaultValue={collection.name}
            required
          />
          <OptionalTextField
            name="description"
            label={t("description")}
            maxLength={1000}
            rows={2}
            defaultValue={collection.description ?? ""}
          />
        </AuthForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("deleteHeading")}</h2>
        <p className="text-sm opacity-80">{t("deleteIntro")}</p>
        <AuthForm
          action={deleteCollection}
          submitLabel={t("delete")}
          pendingLabel={t("pending")}
          destructive
        >
          <input type="hidden" name="collectionId" value={collection.id} />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
