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
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.resource");
  // Le titre de la fiche n'est pas mis dans l'onglet avant d'avoir vérifié le
  // droit de la lire : la page s'en charge.
  return { title: t("title"), robots: { index: false } };
}

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

  const [t, tReason, { notice }] = await Promise.all([
    getTranslations("Catalogue.resource"),
    getTranslations("Catalogue.reportReason"),
    searchParams,
  ]);

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

      <ResourceSummary resource={resource} />
      <p className="text-sm opacity-70">{t("externalNotice")}</p>

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
