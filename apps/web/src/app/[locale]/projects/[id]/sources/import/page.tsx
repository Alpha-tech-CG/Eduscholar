import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthPageShell } from "@/components/auth/page-shell";
import { ReferenceImportForm } from "@/components/projects/reference-import-form";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.import");
  return { title: t("title"), robots: { index: false } };
}

export default async function ReferenceImportPage({
  params,
}: PageProps<"/[locale]/projects/[id]/sources/import">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/sources/import`);

  // Le projet d'autrui et un projet inexistant répondent pareil.
  const project = await getProject(id);
  if (!project) notFound();

  const [t, messages] = await Promise.all([getTranslations("Projects.import"), getMessages()]);

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro", { project: project.title })}
      footer={
        <p>
          <Link href={`/projects/${project.id}/sources`} className="underline underline-offset-4">
            {t("toSources")}
          </Link>
        </p>
      }
    >
      <ul className="list-disc pl-5 text-sm opacity-80">
        <li>{t("rulePrivate")}</li>
        <li>{t("ruleLimits")}</li>
        <li>{t("ruleNoStorage")}</li>
      </ul>
      {/* Le formulaire, côté client, a besoin de ses propres textes. */}
      <NextIntlClientProvider
        messages={{
          Auth: messages.Auth,
          Projects: { import: messages.Projects.import, sources: { type: messages.Projects.sources.type } },
        }}
      >
        <ReferenceImportForm projectId={project.id} />
      </NextIntlClientProvider>
    </AuthPageShell>
  );
}
