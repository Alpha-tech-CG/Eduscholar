import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";
import { addSection, moveSection } from "@/lib/projects/section-actions";
import { getSections } from "@/lib/projects/section-queries";
import { numberSections, SECTION_LEVELS } from "@/lib/projects/section-schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.outline");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = { moved: "moved", deleted: "deleted" } as const;
const INDENT = ["", "ps-6", "ps-12"] as const;

export default async function ProjectOutlinePage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/outline">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/outline`);

  const project = await getProject(id);
  if (!project) notFound();

  const [t, sections, { notice }] = await Promise.all([
    getTranslations("Projects.outline"),
    getSections(project.id),
    searchParams,
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;
  const numbers = numberSections((sections ?? []).map((section) => section.level));

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
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("list", { count: sections?.length ?? 0 })}</h2>
        {sections === null ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {t("loadFailed")}
          </p>
        ) : sections.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ol className="flex list-none flex-col gap-3">
            {sections.map((section, index) => (
              <li
                key={section.id}
                data-testid="outline-item"
                className={`flex flex-col gap-2 rounded border border-foreground/20 p-3 ${INDENT[section.level - 1] ?? ""}`}
              >
                <Link
                  href={`/projects/${project.id}/outline/${section.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  <span data-testid="section-number">{numbers[index]}</span> <span>{section.title}</span>
                </Link>
                <div className="flex flex-wrap gap-3">
                  {index > 0 ? (
                    <AuthForm
                      action={moveSection}
                      submitLabel={t("moveUp", { title: section.title })}
                      pendingLabel={t("pending")}
                    >
                      <input type="hidden" name="projectId" value={project.id} />
                      <input type="hidden" name="sectionId" value={section.id} />
                      <input type="hidden" name="direction" value="up" />
                    </AuthForm>
                  ) : null}
                  {index < sections.length - 1 ? (
                    <AuthForm
                      action={moveSection}
                      submitLabel={t("moveDown", { title: section.title })}
                      pendingLabel={t("pending")}
                    >
                      <input type="hidden" name="projectId" value={project.id} />
                      <input type="hidden" name="sectionId" value={section.id} />
                      <input type="hidden" name="direction" value="down" />
                    </AuthForm>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("addHeading")}</h2>
        <AuthForm action={addSection} submitLabel={t("add")} pendingLabel={t("pending")}>
          <input type="hidden" name="projectId" value={project.id} />
          <OptionalTextField name="title" label={t("fields.title")} maxLength={300} required />
          <SelectField
            name="level"
            label={t("fields.level")}
            placeholder={t("choose")}
            options={SECTION_LEVELS.map((level) => ({ value: level, label: t(`levels.${level}`) }))}
            defaultValue="1"
            required
          />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
