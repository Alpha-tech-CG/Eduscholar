import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, CheckboxField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getReferenceData } from "@/lib/profile/queries";
import { deleteProject } from "@/lib/projects/actions";
import { getProject } from "@/lib/projects/queries";
import { countSections } from "@/lib/projects/section-queries";
import { countSources } from "@/lib/projects/source-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects");
  // Titre générique : celui du projet n'est affiché qu'à son propriétaire.
  return { title: t("projectTitle"), robots: { index: false } };
}

export default async function ProjectPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}`);

  // Le projet d'un autre et un projet inexistant répondent de la même façon.
  const project = await getProject(id);
  if (!project) notFound();

  const locale = await getLocale();
  const [t, tStatus, format, reference, sourceCount, sectionCount, { notice }] = await Promise.all([
    getTranslations("Projects"),
    getTranslations("Projects.status"),
    getFormatter(),
    getReferenceData(locale),
    countSources(project.id),
    countSections(project.id),
    searchParams,
  ]);

  const program = reference.programs.find((item) => item.code === project.programCode)?.label;
  const facts: Array<[string, string | null | undefined]> = [
    [t("fields.status"), tStatus(project.status as "draft")],
    [t("fields.program"), program],
    [
      t("fields.dueDate"),
      project.dueDate
        ? format.dateTime(new Date(`${project.dueDate}T00:00:00Z`), {
            dateStyle: "long",
            timeZone: "UTC",
          })
        : null,
    ],
    [t("fields.supervisorName"), project.supervisorName],
  ];
  const texts: Array<[string, string | null]> = [
    [t("fields.context"), project.context],
    [t("fields.problemStatement"), project.problemStatement],
    [t("fields.mainQuestion"), project.mainQuestion],
  ];
  const lists: Array<[string, string[]]> = [
    [t("fields.secondaryQuestions"), project.secondaryQuestions],
    [t("fields.hypotheses"), project.hypotheses],
  ];
  const more: Array<[string, string | null]> = [
    [t("fields.generalObjective"), project.generalObjective],
  ];
  const objectives: Array<[string, string[]]> = [
    [t("fields.specificObjectives"), project.specificObjectives],
  ];
  const rest: Array<[string, string | null]> = [
    [t("fields.theoreticalFramework"), project.theoreticalFramework],
    [t("fields.methodology"), project.methodology],
    [t("fields.fieldwork"), project.fieldwork],
    [t("fields.populationSample"), project.populationSample],
    [t("fields.outline"), project.outline],
  ];

  const textBlock = ([heading, value]: [string, string | null]) =>
    value ? (
      <section key={heading} className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <p className="whitespace-pre-line">{value}</p>
      </section>
    ) : null;
  const listBlock = ([heading, items]: [string, string[]]) =>
    items.length > 0 ? (
      <section key={heading} className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <ol className="list-decimal ps-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
    ) : null;

  const filled =
    [...texts, ...more, ...rest].some(([, value]) => value) ||
    [...lists, ...objectives].some(([, items]) => items.length > 0);

  return (
    <AuthPageShell
      wide
      title={project.title}
      footer={
        <p>
          <Link href="/projects" className="underline underline-offset-4">
            {t("back")}
          </Link>
        </p>
      }
    >
      {notice === "saved" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("saved")}
        </p>
      ) : null}

      <p className="text-sm opacity-70">{t("privateNotice")}</p>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        {facts
          .filter(([, value]) => value)
          .map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-sm opacity-70">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <p>
        <Link
          href={`/projects/${project.id}/edit`}
          className="rounded bg-foreground px-4 py-2 font-medium text-background"
        >
          {t("edit")}
        </Link>
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("sources.heading")}</h2>
        <p data-testid="source-count">{t("sources.count", { count: sourceCount })}</p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          <li>
            <Link href={`/projects/${project.id}/sources`} className="underline underline-offset-4">
              {t("sources.manage")}
            </Link>
          </li>
          {sourceCount > 0 ? (
            <>
              <li>
                <Link href={`/projects/${project.id}/matrix`} className="underline underline-offset-4">
                  {t("sources.toMatrix")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/projects/${project.id}/bibliography`}
                  className="underline underline-offset-4"
                >
                  {t("bibliography.title")}
                </Link>
              </li>
            </>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("sharing.heading")}</h2>
        <p className="text-sm opacity-80">{t("sharing.intro")}</p>
        <p>
          <Link href={`/projects/${project.id}/sharing`} className="underline underline-offset-4">
            {t("sharing.manage")}
          </Link>
        </p>
        <p>
          <Link href={`/projects/${project.id}/versions`} className="underline underline-offset-4">
            {t("sharing.versions")}
          </Link>
        </p>
        <p>
          <Link href={`/projects/${project.id}/tasks`} className="underline underline-offset-4">
            {t("sharing.tasks")}
          </Link>
        </p>
        <p>
          <Link href={`/projects/${project.id}/coherence`} className="underline underline-offset-4">
            {t("sharing.coherence")}
          </Link>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("outline.heading")}</h2>
        <p data-testid="section-count">{t("outline.count", { count: sectionCount })}</p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          <li>
            <Link href={`/projects/${project.id}/outline`} className="underline underline-offset-4">
              {t("outline.manage")}
            </Link>
          </li>
          <li>
            <Link href={`/projects/${project.id}/document`} className="underline underline-offset-4">
              {t("document.open")}
            </Link>
          </li>
        </ul>
      </section>

      {filled ? null : <p className="opacity-70">{t("notFilled")}</p>}
      {texts.map(textBlock)}
      {lists.map(listBlock)}
      {more.map(textBlock)}
      {objectives.map(listBlock)}
      {rest.map(textBlock)}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("deleteHeading")}</h2>
        <p className="text-sm opacity-80">{t("deleteIntro")}</p>
        <AuthForm
          action={deleteProject}
          submitLabel={t("delete")}
          pendingLabel={t("pending")}
          destructive
        >
          <input type="hidden" name="projectId" value={project.id} />
          <CheckboxField name="confirm" label={t("deleteConfirm")} />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
