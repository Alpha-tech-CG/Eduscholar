import { getLocale, getTranslations } from "next-intl/server";
import {
  CheckboxField,
  CheckboxGroup,
  OptionalTextField,
  SelectField,
} from "@/components/auth/form";
import { getCatalogueReference, type Resource } from "@/lib/catalogue/queries";
import { ACCESS_STATUSES, THESIS_DEGREES } from "@/lib/catalogue/schemas";
import { getReferenceData } from "@/lib/profile/queries";

type ResourceFormFieldsProps = {
  /** Fiche à modifier ; absente pour une nouvelle soumission. */
  resource?: Resource;
  /** Filière proposée par défaut : celle du profil. */
  defaultProgramCode?: string | null;
};

/** Champs d'une fiche de ressource, communs à la soumission et à sa correction. */
export async function ResourceFormFields({
  resource,
  defaultProgramCode,
}: ResourceFormFieldsProps) {
  const locale = await getLocale();
  const [t, reference, catalogue] = await Promise.all([
    getTranslations("Catalogue.form"),
    getReferenceData(locale),
    getCatalogueReference(locale),
  ]);
  const tStatus = await getTranslations("Catalogue.accessStatus");
  const tDegree = await getTranslations("Catalogue.thesisDegree");

  const programCode =
    resource?.programCode ?? defaultProgramCode ?? reference.programs[0]?.code ?? "";
  const choices = <T extends { code: string; label: string }>(items: T[]) =>
    items.map((item) => ({ value: item.code, label: item.label }));

  return (
    <>
      <SelectField
        name="typeCode"
        label={t("type")}
        placeholder={t("choose")}
        options={choices(catalogue.types)}
        defaultValue={resource?.typeCode}
        required
      />
      <OptionalTextField
        name="title"
        label={t("title")}
        defaultValue={resource?.title}
        maxLength={500}
        required
      />
      <OptionalTextField
        name="authors"
        label={t("authors")}
        hint={t("authorsHint")}
        defaultValue={resource?.authors.join("\n")}
        maxLength={5000}
        rows={3}
      />
      <OptionalTextField
        name="institutionName"
        label={t("institution")}
        hint={t("institutionHint")}
        defaultValue={resource?.institutionName ?? undefined}
        maxLength={200}
      />
      <OptionalTextField
        name="abstract"
        label={t("abstract")}
        defaultValue={resource?.abstract ?? undefined}
        maxLength={5000}
        rows={5}
      />
      <OptionalTextField
        name="publicationYear"
        label={t("year")}
        defaultValue={resource?.publicationYear?.toString()}
        maxLength={4}
        kind="numeric"
      />
      <SelectField
        name="thesisDegree"
        label={t("thesisDegree")}
        placeholder={t("notApplicable")}
        options={THESIS_DEGREES.map((value) => ({ value, label: tDegree(value) }))}
        defaultValue={resource?.thesisDegree ?? undefined}
      />
      <SelectField
        name="languageCode"
        label={t("language")}
        placeholder={t("choose")}
        options={choices(catalogue.languages)}
        defaultValue={resource?.languageCode ?? locale}
        required
      />
      <SelectField
        name="countryCode"
        label={t("country")}
        placeholder={t("notApplicable")}
        options={choices(reference.countries)}
        defaultValue={resource?.countryCode ?? undefined}
      />
      <SelectField
        name="programCode"
        label={t("program")}
        placeholder={t("choose")}
        options={choices(reference.programs)}
        defaultValue={programCode}
        required
      />
      <CheckboxGroup
        name="levelCodes"
        legend={t("levels")}
        options={choices(reference.levels)}
        defaultValues={resource?.levelCodes ?? []}
      />
      <CheckboxGroup
        name="subjectCodes"
        legend={t("subjects")}
        options={choices(reference.subjects.filter((item) => item.programCode === programCode))}
        defaultValues={resource?.subjectCodes ?? []}
      />
      <OptionalTextField
        name="tags"
        label={t("tags")}
        hint={t("tagsHint")}
        defaultValue={resource?.tags.join(", ")}
        maxLength={900}
      />

      <h2 className="mt-2 text-lg font-semibold">{t("provenanceHeading")}</h2>
      <p className="text-sm opacity-80">{t("provenanceIntro")}</p>
      <OptionalTextField
        name="officialUrl"
        label={t("officialUrl")}
        hint={t("officialUrlHint")}
        defaultValue={resource?.officialUrl ?? undefined}
        maxLength={2000}
        kind="url"
        required
      />
      <OptionalTextField
        name="doi"
        label={t("doi")}
        hint={t("doiHint")}
        defaultValue={resource?.doi ?? undefined}
        maxLength={255}
      />
      <SelectField
        name="accessStatus"
        label={t("accessStatus")}
        placeholder={t("choose")}
        options={ACCESS_STATUSES.map((value) => ({ value, label: tStatus(value) }))}
        defaultValue={resource?.accessStatus ?? "unknown"}
        required
      />
      <SelectField
        name="licenseCode"
        label={t("license")}
        placeholder={t("choose")}
        options={choices(catalogue.licenses)}
        defaultValue={resource?.licenseCode ?? "unknown"}
        required
      />
      <p className="text-sm opacity-80">{t("licenseHint")}</p>
      <OptionalTextField
        name="permissionProof"
        label={t("permissionProof")}
        hint={t("permissionProofHint")}
        maxLength={2000}
        rows={2}
      />
      <OptionalTextField
        name="contributorComment"
        label={t("comment")}
        maxLength={2000}
        rows={2}
      />
      <CheckboxField name="rightsDeclared" label={t("rightsDeclared")} />
    </>
  );
}
