import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getReferenceData } from "@/lib/profile/queries";
import { createProject } from "@/lib/projects/actions";
import { getProjects } from "@/lib/projects/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects");
  return { title: t("title"), robots: { index: false } };
}

export default async function ProjectsPage({ searchParams }: PageProps<"/[locale]/projects">) {
  const { profile } = await requireOnboardedUser("/projects");
  const locale = await getLocale();
  const [t, tStatus, format, projects, reference, { notice }] = await Promise.all([
    getTranslations("Projects"),
    getTranslations("Projects.status"),
    getFormatter(),
    getProjects(),
    getReferenceData(locale),
    searchParams,
  ]);

  return (
    <AuthPageShell wide title={t("title")} intro={t("intro")}>
      {notice === "deleted" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("deleted")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("mine", { count: projects.length })}</h2>
        {projects.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {projects.map((project) => (
              <li key={project.id} className="rounded border border-foreground/20 p-3">
                <Link
                  href={`/projects/${project.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {project.title}
                </Link>
                <p className="text-sm opacity-80">
                  <span data-testid="project-status">{tStatus(project.status as "draft")}</span>
                  {project.dueDate ? (
                    <>
                      <span aria-hidden="true">{t("separator")}</span>
                      <span>
                        {t("dueOn", {
                          date: format.dateTime(new Date(`${project.dueDate}T00:00:00Z`), {
                            dateStyle: "long",
                            timeZone: "UTC",
                          }),
                        })}
                      </span>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("newProject")}</h2>
        <AuthForm action={createProject} submitLabel={t("create")} pendingLabel={t("pending")}>
          <OptionalTextField
            name="title"
            label={t("fields.title")}
            hint={t("fields.titleHint")}
            maxLength={300}
            required
          />
          <SelectField
            name="programCode"
            label={t("fields.program")}
            placeholder={t("choose")}
            options={reference.programs.map(({ code, label }) => ({ value: code, label }))}
            defaultValue={profile.programCode ?? undefined}
          />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
