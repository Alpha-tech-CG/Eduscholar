import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { ResourceFormFields } from "@/components/catalogue/resource-form-fields";
import { Link } from "@/i18n/navigation";
import { submitResource } from "@/lib/catalogue/actions";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.contribute");
  return { title: t("title"), robots: { index: false } };
}

export default async function ContributePage() {
  const { profile } = await requireOnboardedUser("/contribute");
  const t = await getTranslations("Catalogue.contribute");

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/contributions" className="underline underline-offset-4">
            {t("myContributions")}
          </Link>
        </p>
      }
    >
      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("ruleLink")}</li>
        <li>{t("ruleRights")}</li>
        <li>{t("ruleReview")}</li>
      </ul>
      <AuthForm action={submitResource} submitLabel={t("submit")} pendingLabel={t("pending")}>
        <ResourceFormFields defaultProgramCode={profile.programCode} />
      </AuthForm>
    </AuthPageShell>
  );
}
