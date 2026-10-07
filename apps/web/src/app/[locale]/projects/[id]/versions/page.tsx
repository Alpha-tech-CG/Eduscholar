import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, CheckboxField, OptionalTextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { VersionList } from "@/components/projects/version-list";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";
import { submitVersion } from "@/lib/projects/version-actions";
import { getProjectVersions } from "@/lib/projects/version-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Versions");
  return { title: t("title"), robots: { index: false } };
}

/** Versions soumises d'un projet, et soumission d'une nouvelle. Réservé à son propriétaire. */
export default async function ProjectVersionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/versions">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/versions`);

  // Le projet d'un autre et un projet inexistant répondent de la même façon.
  const project = await getProject(id);
  const listing = project ? await getProjectVersions(project.id) : null;
  if (!project || !listing) notFound();

  const [t, { notice }] = await Promise.all([getTranslations("Versions"), searchParams]);

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro", { project: project.title })}
      footer={
        <p>
          <Link href={`/projects/${project.id}`} className="underline underline-offset-4">
            {t("backToProject")}
          </Link>
        </p>
      }
    >
      {notice === "submitted" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("noticeSubmitted")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("listHeading", { count: listing.versions.length })}</h2>
        <VersionList basePath={`/projects/${project.id}/versions`} versions={listing.versions} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("submitHeading")}</h2>
        <p className="text-sm opacity-80">{t("submitIntro")}</p>
        <AuthForm action={submitVersion} submitLabel={t("submit")} pendingLabel={t("pending")}>
          <input type="hidden" name="projectId" value={project.id} />
          <OptionalTextField name="label" label={t("fields.label")} hint={t("fields.labelHint")} maxLength={120} />
          <OptionalTextField name="note" label={t("fields.note")} maxLength={1000} rows={3} />
          <CheckboxField name="confirm" label={t("submitConfirm")} />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
