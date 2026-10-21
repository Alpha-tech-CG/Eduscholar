import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthPageShell } from "@/components/auth/page-shell";
import { ResourceCard } from "@/components/catalogue/resource-card";
import { Link } from "@/i18n/navigation";
import { getRecommendations } from "@/lib/assistance/queries";
import { chosenProject } from "@/lib/assistance/schemas";
import { getCatalogueReference } from "@/lib/catalogue/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProjects } from "@/lib/projects/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Assistance.recommendations");
  return { title: t("title"), robots: { index: false } };
}

const ALERT = "rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300";

/**
 * Fiches du catalogue recommandées à l'utilisateur, d'après son seul profil
 * et, s'il le choisit, l'un de ses projets. Chaque fiche dit pourquoi elle est là.
 */
export default async function RecommendationsPage({ searchParams }: PageProps<"/[locale]/recommendations">) {
  await requireOnboardedUser("/recommendations");
  const locale = await getLocale();
  const [t, catalogue, projects, params] = await Promise.all([
    getTranslations("Assistance.recommendations"),
    getCatalogueReference(locale),
    getProjects(),
    searchParams,
  ]);

  // Le projet lu dans l'adresse ne vaut que s'il est l'un des siens ; la base le revérifie.
  const projectId = chosenProject(params.project, projects.map(({ id }) => id));
  const loaded = await getRecommendations(projectId);
  const typeLabel = (code: string) => catalogue.types.find((item) => item.code === code)?.label ?? code;

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/search" className="underline underline-offset-4">
            {t("toSearch")}
          </Link>
        </p>
      }
    >
      <p className="rounded border border-foreground/30 p-3 text-sm" data-testid="recommendations-origin">
        {t("origin")}
      </p>

      {projects.length > 0 ? (
        // Formulaire en GET, sans JavaScript : le choix voyage dans l'adresse.
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="recommendations-project" className="font-medium">
              {t("project")}
            </label>
            <select
              id="recommendations-project"
              name="project"
              defaultValue={projectId ?? ""}
              className="rounded border border-foreground/30 bg-background px-3 py-2"
            >
              <option value="">{t("noProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
            <p className="text-sm opacity-70">{t("projectHint")}</p>
          </div>
          <button type="submit" className="rounded border border-foreground/30 px-4 py-2 font-medium">
            {t("refine")}
          </button>
        </form>
      ) : null}

      <section aria-labelledby="recommendations-heading" className="flex flex-col gap-3">
        <h2 id="recommendations-heading" className="text-lg font-semibold">
          {loaded.status === "ok" ? t("results", { count: loaded.items.length }) : t("resultsHeading")}
        </h2>
        {loaded.status === "rate_limited" ? (
          <p role="alert" className={ALERT}>
            {t("rateLimited")}
          </p>
        ) : loaded.status === "failed" ? (
          <p role="alert" className={ALERT}>
            {t("unavailable")}
          </p>
        ) : loaded.items.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {loaded.items.map(({ resource, reasons }) => (
              <ResourceCard key={resource.id} resource={resource} typeLabel={typeLabel(resource.typeCode)}>
                {reasons.length > 0 ? (
                  <p className="text-sm" data-testid="recommendation-reasons">
                    <span className="opacity-70">{t("because")}</span>{" "}
                    {reasons.map((reason) => t(`reasons.${reason}`)).join(t("separator"))}
                  </p>
                ) : null}
              </ResourceCard>
            ))}
          </ul>
        )}
      </section>
    </AuthPageShell>
  );
}
