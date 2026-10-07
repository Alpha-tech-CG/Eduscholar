import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthPageShell } from "@/components/auth/page-shell";
import { VersionList } from "@/components/projects/version-list";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProjectVersions } from "@/lib/projects/version-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Versions");
  return { title: t("title"), robots: { index: false } };
}

/** Versions soumises d'un projet partagé, pour ses membres. */
export default async function SharedVersionsPage({ params }: PageProps<"/[locale]/shared/[id]/versions">) {
  const { id } = await params;
  await requireOnboardedUser(`/shared/${id}/versions`);

  // Projet inexistant, supprimé, ou dont on n'est pas membre : même réponse.
  const listing = await getProjectVersions(id);
  if (!listing || listing.role === "owner") notFound();
  const t = await getTranslations("Versions");

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={listing.role === "supervisor" ? t("sharedIntroSupervisor") : t("sharedIntroViewer")}
      footer={
        <p>
          <Link href={`/shared/${id}`} className="underline underline-offset-4">
            {t("backToShared")}
          </Link>
        </p>
      }
    >
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("listHeading", { count: listing.versions.length })}</h2>
        <VersionList basePath={`/shared/${id}/versions`} versions={listing.versions} />
      </section>
    </AuthPageShell>
  );
}
