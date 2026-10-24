import { getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { Link } from "@/i18n/navigation";
import { setCollectionItemNote, setFavoriteNote, setFavoriteTag } from "@/lib/library/actions";
import { NOTE_MAX_LENGTH, TAG_MAX_LENGTH, TAGS_PER_FAVORITE } from "@/lib/library/schemas";

type ItemDetailsProps = {
  resourceId: string;
  note: string | null;
  /** Tags du favori ; absent pour un élément de collection. */
  tags?: string[];
  /** Collection de l'élément ; absent pour un favori. */
  collectionId?: string;
  /** Filtre par tag en cours, gardé au retour. */
  returnTag?: string | null;
};

/** Note privée et tags personnels d'un élément de la bibliothèque. Visibles du seul titulaire. */
export async function ItemDetails({ resourceId, note, tags, collectionId, returnTag }: ItemDetailsProps) {
  const t = await getTranslations("Library");
  const isFavorite = collectionId === undefined;
  const tagList = tags ?? [];

  return (
    <div className="flex flex-col gap-2 text-sm">
      {isFavorite && tagList.length > 0 ? (
        <ul aria-label={t("tagsLabel")} data-testid="item-tags" className="flex flex-wrap gap-2">
          {tagList.map((tag) => (
            <li key={tag}>
              <Link
                href={{ pathname: "/library", query: { tag } }}
                className="rounded border border-foreground/30 px-2 py-0.5 underline-offset-4 hover:underline"
              >
                {tag}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {note ? (
        <p data-testid="item-note" className="whitespace-pre-line rounded bg-foreground/5 p-2">
          <span className="sr-only">{t("noteLabel")}</span>
          {note}
        </p>
      ) : null}

      <details className="rounded border border-foreground/20 p-2">
        <summary className="cursor-pointer">{isFavorite ? t("editNoteAndTags") : t("editNote")}</summary>
        <div className="mt-3 flex flex-col gap-4">
          <AuthForm
            action={isFavorite ? setFavoriteNote : setCollectionItemNote}
            submitLabel={t("saveNote")}
            pendingLabel={t("pending")}
          >
            <input type="hidden" name="resourceId" value={resourceId} />
            {collectionId ? <input type="hidden" name="collectionId" value={collectionId} /> : null}
            {returnTag ? <input type="hidden" name="returnTag" value={returnTag} /> : null}
            <OptionalTextField
              name="note"
              label={t("noteLabel")}
              hint={t("noteHint", { max: NOTE_MAX_LENGTH })}
              maxLength={NOTE_MAX_LENGTH}
              rows={3}
              defaultValue={note ?? ""}
            />
          </AuthForm>

          {isFavorite ? (
            <>
              {tagList.length < TAGS_PER_FAVORITE ? (
                <AuthForm action={setFavoriteTag} submitLabel={t("addTag")} pendingLabel={t("pending")}>
                  <input type="hidden" name="resourceId" value={resourceId} />
                  <input type="hidden" name="present" value="true" />
                  {returnTag ? <input type="hidden" name="returnTag" value={returnTag} /> : null}
                  <OptionalTextField
                    name="tag"
                    label={t("tagLabel")}
                    hint={t("tagHint", { max: TAG_MAX_LENGTH, count: TAGS_PER_FAVORITE })}
                    maxLength={TAG_MAX_LENGTH}
                    required
                  />
                </AuthForm>
              ) : (
                <p className="opacity-80">{t("tagsFull", { count: TAGS_PER_FAVORITE })}</p>
              )}
              {tagList.map((tag) => (
                <AuthForm
                  key={tag}
                  action={setFavoriteTag}
                  submitLabel={t("removeTag", { tag })}
                  pendingLabel={t("pending")}
                >
                  <input type="hidden" name="resourceId" value={resourceId} />
                  <input type="hidden" name="present" value="false" />
                  <input type="hidden" name="tag" value={tag} />
                  {returnTag ? <input type="hidden" name="returnTag" value={returnTag} /> : null}
                </AuthForm>
              ))}
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
}
