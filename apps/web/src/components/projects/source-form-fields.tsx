import { getTranslations } from "next-intl/server";
import { OptionalTextField, SelectField } from "@/components/auth/form";
import type { Source } from "@/lib/projects/source-queries";
import { SOURCE_TYPES } from "@/lib/projects/source-schemas";

/** Champs d'une source bibliographique, pour l'ajout comme pour la correction. */
export async function SourceFormFields({ source }: { source?: Source }) {
  const [t, tType] = await Promise.all([
    getTranslations("Projects.sources.fields"),
    getTranslations("Projects.sources.type"),
  ]);

  return (
    <>
      <SelectField
        name="sourceType"
        label={t("sourceType")}
        placeholder={t("choose")}
        options={SOURCE_TYPES.map((type) => ({ value: type, label: tType(type) }))}
        defaultValue={source?.sourceType}
        required
      />
      <OptionalTextField
        name="title"
        label={t("title")}
        maxLength={500}
        defaultValue={source?.title ?? ""}
        required
      />
      <OptionalTextField
        name="authors"
        label={t("authors")}
        hint={t("authorsHint")}
        maxLength={10500}
        rows={3}
        defaultValue={source?.authors.join("\n") ?? ""}
      />
      <OptionalTextField
        name="publicationYear"
        label={t("publicationYear")}
        maxLength={4}
        kind="numeric"
        defaultValue={source?.publicationYear?.toString() ?? ""}
      />
      <OptionalTextField
        name="containerTitle"
        label={t("containerTitle")}
        hint={t("containerTitleHint")}
        maxLength={300}
        defaultValue={source?.containerTitle ?? ""}
      />
      <OptionalTextField
        name="publisher"
        label={t("publisher")}
        maxLength={200}
        defaultValue={source?.publisher ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <OptionalTextField name="volume" label={t("volume")} maxLength={50} defaultValue={source?.volume ?? ""} />
        <OptionalTextField name="issue" label={t("issue")} maxLength={50} defaultValue={source?.issue ?? ""} />
        <OptionalTextField name="pages" label={t("pages")} maxLength={50} defaultValue={source?.pages ?? ""} />
      </div>
      <OptionalTextField
        name="doi"
        label={t("doi")}
        hint={t("doiHint")}
        maxLength={300}
        defaultValue={source?.doi ?? ""}
      />
      <OptionalTextField
        name="url"
        label={t("url")}
        maxLength={2000}
        kind="url"
        defaultValue={source?.url ?? ""}
      />
      <OptionalTextField
        name="accessedOn"
        label={t("accessedOn")}
        hint={t("accessedOnHint")}
        maxLength={10}
        defaultValue={source?.accessedOn ?? ""}
      />
    </>
  );
}
