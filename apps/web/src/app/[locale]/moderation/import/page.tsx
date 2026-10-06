import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireModerator } from "@/lib/catalogue/guard";
import { importResourceByDoi } from "@/lib/catalogue/import-actions";
import { getCatalogueReference } from "@/lib/catalogue/queries";
import { getReferenceData } from "@/lib/profile/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.import");
  return { title: t("title"), robots: { index: false } };
}

export default async function ImportResourcePage() {
  await requireModerator("/moderation/import");
  const locale = await getLocale();
  const [t, reference, catalogue] = await Promise.all([
    getTranslations("Catalogue.import"),
    getReferenceData(locale),
    getCatalogueReference(locale),
  ]);

  return (
    <AuthPageShell
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/moderation" className="underline underline-offset-4">
            {t("back")}
          </Link>
        </p>
      }
    >
      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("ruleMetadata")}</li>
        <li>{t("rulePending")}</li>
        <li>{t("ruleUnknown")}</li>
      </ul>
      <AuthForm action={importResourceByDoi} submitLabel={t("submit")} pendingLabel={t("pending")}>
        <OptionalTextField name="doi" label={t("doi")} hint={t("doiHint")} maxLength={300} required />
        <SelectField
          name="programCode"
          label={t("program")}
          placeholder={t("choose")}
          options={reference.programs.map(({ code, label }) => ({ value: code, label }))}
          defaultValue={reference.programs.length === 1 ? reference.programs[0]?.code : undefined}
          required
        />
        <SelectField
          name="languageCode"
          label={t("language")}
          placeholder={t("languageFromSource")}
          options={catalogue.languages.map(({ code, label }) => ({ value: code, label }))}
        />
        <p className="text-sm opacity-70">{t("languageHint")}</p>
      </AuthForm>
    </AuthPageShell>
  );
}
