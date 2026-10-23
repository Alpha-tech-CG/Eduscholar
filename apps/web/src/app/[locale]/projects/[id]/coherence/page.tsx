import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthPageShell } from "@/components/auth/page-shell";
import { CoherenceReport } from "@/components/projects/coherence-report";
import { Link } from "@/i18n/navigation";
import { getCoherenceReport } from "@/lib/assistance/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";
import { getSections } from "@/lib/projects/section-queries";
import { getAllSources } from "@/lib/projects/source-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Assistance.coherence");
  return { title: t("title"), robots: { index: false } };
}

const ALERT = "rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300";

/** Contrôles de cohérence d'un projet, pour son propriétaire. */
export default async function ProjectCoherencePage({ params }: PageProps<"/[locale]/projects/[id]/coherence">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/coherence`);

  // Propriété d'abord, avant toute lecture du rapport : `getProject` ne rend
  // un projet qu'à son propriétaire (RLS). Un membre, un tiers, un projet
  // inexistant reçoivent « introuvable » — même si le rapport, ensuite, ne
  // pouvait pas être lu ou était limité.
  const project = await getProject(id);
  if (!project) notFound();

  // Titres des sources et des sections : lus à part, pour nommer ce que les
  // constats désignent. Leur échec n'empêche pas le rapport.
  const [t, loaded, sources, sections] = await Promise.all([
    getTranslations("Assistance.coherence"),
    getCoherenceReport(project.id),
    getAllSources(project.id),
    getSections(project.id),
  ]);
  if (loaded.status === "not_found") notFound();
  // Cette page est celle du propriétaire : un membre lit le rapport sous `/shared`.
  if (loaded.status === "ok" && loaded.report.role !== "owner") notFound();

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
      {loaded.status === "ok" ? (
        <CoherenceReport
          report={loaded.report}
          projectId={project.id}
          scope="owner"
          sourceTitles={new Map((sources ?? []).map((source) => [source.id, source.title]))}
          sectionTitles={new Map((sections ?? []).map((section) => [section.id, section.title]))}
        />
      ) : (
        <p role="alert" className={ALERT}>
          {t(loaded.status === "rate_limited" ? "rateLimited" : "unavailable")}
        </p>
      )}
    </AuthPageShell>
  );
}
