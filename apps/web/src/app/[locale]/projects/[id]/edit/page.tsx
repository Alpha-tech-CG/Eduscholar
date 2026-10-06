import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getReferenceData } from "@/lib/profile/queries";
import { updateProject } from "@/lib/projects/actions";
import { getProject } from "@/lib/projects/queries";
import { PROJECT_STATUSES } from "@/lib/projects/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects");
  return { title: t("editTitle"), robots: { index: false } };
}

export default async function EditProjectPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/edit">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/edit`);

  const project = await getProject(id);
  if (!project) notFound();

  const locale = await getLocale();
  const [t, tStatus, reference, { notice }] = await Promise.all([
    getTranslations("Projects"),
    getTranslations("Projects.status"),
    getReferenceData(locale),
    searchParams,
  ]);
  const lines = (items: string[]) => items.join("\n");

  return (
    <AuthPageShell
      wide
      title={t("editTitle")}
      intro={t("editIntro")}
      footer={
        <p>
          <Link href={`/projects/${project.id}`} className="underline underline-offset-4">
            {t("cancel")}
          </Link>
        </p>
      }
    >
      {notice === "created" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("created")}
        </p>
      ) : null}

      <AuthForm action={updateProject} submitLabel={t("save")} pendingLabel={t("pending")}>
        <input type="hidden" name="projectId" value={project.id} />
        <input type="hidden" name="updatedAt" value={project.updatedAt} />

        <OptionalTextField
          name="title"
          label={t("fields.title")}
          hint={t("fields.titleHint")}
          maxLength={300}
          defaultValue={project.title}
          required
        />
        <SelectField
          name="programCode"
          label={t("fields.program")}
          placeholder={t("choose")}
          options={reference.programs.map(({ code, label }) => ({ value: code, label }))}
          defaultValue={project.programCode ?? undefined}
        />
        <SelectField
          name="status"
          label={t("fields.status")}
          placeholder={t("choose")}
          options={PROJECT_STATUSES.map((status) => ({ value: status, label: tStatus(status) }))}
          defaultValue={project.status}
          required
        />
        <OptionalTextField
          name="dueDate"
          label={t("fields.dueDate")}
          hint={t("fields.dueDateHint")}
          maxLength={10}
          defaultValue={project.dueDate ?? ""}
        />
        <OptionalTextField
          name="supervisorName"
          label={t("fields.supervisorName")}
          hint={t("fields.supervisorNameHint")}
          maxLength={200}
          defaultValue={project.supervisorName ?? ""}
        />

        <h2 className="text-lg font-semibold">{t("sections.question")}</h2>
        <OptionalTextField
          name="context"
          label={t("fields.context")}
          maxLength={5000}
          rows={5}
          defaultValue={project.context ?? ""}
        />
        <OptionalTextField
          name="problemStatement"
          label={t("fields.problemStatement")}
          maxLength={5000}
          rows={5}
          defaultValue={project.problemStatement ?? ""}
        />
        <OptionalTextField
          name="mainQuestion"
          label={t("fields.mainQuestion")}
          maxLength={1000}
          rows={2}
          defaultValue={project.mainQuestion ?? ""}
        />
        <OptionalTextField
          name="secondaryQuestions"
          label={t("fields.secondaryQuestions")}
          hint={t("fields.listHint")}
          maxLength={21000}
          rows={4}
          defaultValue={lines(project.secondaryQuestions)}
        />
        <OptionalTextField
          name="hypotheses"
          label={t("fields.hypotheses")}
          hint={t("fields.listHint")}
          maxLength={21000}
          rows={4}
          defaultValue={lines(project.hypotheses)}
        />

        <h2 className="text-lg font-semibold">{t("sections.objectives")}</h2>
        <OptionalTextField
          name="generalObjective"
          label={t("fields.generalObjective")}
          maxLength={1000}
          rows={2}
          defaultValue={project.generalObjective ?? ""}
        />
        <OptionalTextField
          name="specificObjectives"
          label={t("fields.specificObjectives")}
          hint={t("fields.listHint")}
          maxLength={21000}
          rows={4}
          defaultValue={lines(project.specificObjectives)}
        />

        <h2 className="text-lg font-semibold">{t("sections.method")}</h2>
        <OptionalTextField
          name="theoreticalFramework"
          label={t("fields.theoreticalFramework")}
          maxLength={5000}
          rows={5}
          defaultValue={project.theoreticalFramework ?? ""}
        />
        <OptionalTextField
          name="methodology"
          label={t("fields.methodology")}
          maxLength={5000}
          rows={5}
          defaultValue={project.methodology ?? ""}
        />
        <OptionalTextField
          name="fieldwork"
          label={t("fields.fieldwork")}
          maxLength={2000}
          rows={3}
          defaultValue={project.fieldwork ?? ""}
        />
        <OptionalTextField
          name="populationSample"
          label={t("fields.populationSample")}
          maxLength={2000}
          rows={3}
          defaultValue={project.populationSample ?? ""}
        />

        <h2 className="text-lg font-semibold">{t("sections.outline")}</h2>
        <OptionalTextField
          name="outline"
          label={t("fields.outline")}
          hint={t("fields.outlineHint")}
          maxLength={10000}
          rows={8}
          defaultValue={project.outline ?? ""}
        />
      </AuthForm>
    </AuthPageShell>
  );
}
