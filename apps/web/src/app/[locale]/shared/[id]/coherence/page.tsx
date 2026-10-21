import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthPageShell } from "@/components/auth/page-shell";
import { CoherenceReport } from "@/components/projects/coherence-report";
import { Link } from "@/i18n/navigation";
import { getCoherenceReport } from "@/lib/assistance/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Assistance.coherence");
  // Titre générique : celui du projet n'est affiché qu'à ses membres.
  return { title: t("title"), robots: { index: false } };
}

/**
 * Contrôles de cohérence d'un projet partagé, pour un membre à accès complet.
 * La base ne lui rend que les constats tirés de ce qu'il lit déjà.
 */
export default async function SharedCoherencePage({ params }: PageProps<"/[locale]/shared/[id]/coherence">) {
  const { id } = await params;
  await requireOnboardedUser(`/shared/${id}/coherence`);

  // Projet inexistant, supprimé, d'un tiers, ou ouvert en partie seulement : même réponse.
  const loaded = await getCoherenceReport(id);
  if (loaded.status === "not_found") notFound();
  // Le propriétaire lit le rapport sur sa propre page.
  if (loaded.status === "ok" && loaded.report.role === "owner") notFound();

  const t = await getTranslations("Assistance.coherence");

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("introMember")}
      footer={
        <p>
          <Link href={`/shared/${id}`} className="underline underline-offset-4">
            {t("backToShared")}
          </Link>
        </p>
      }
    >
      {loaded.status === "ok" ? (
        <CoherenceReport report={loaded.report} projectId={id} scope="member" />
      ) : (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t(loaded.status === "rate_limited" ? "rateLimited" : "unavailable")}
        </p>
      )}
    </AuthPageShell>
  );
}
