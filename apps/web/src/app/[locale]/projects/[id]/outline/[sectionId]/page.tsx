import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, CheckboxField, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import {
  citeSource,
  deleteSection,
  removeCitation,
  updateSection,
} from "@/lib/projects/section-actions";
import { getCitations, getSection } from "@/lib/projects/section-queries";
import { countWords, SECTION_BODY_MAX, SECTION_LEVELS } from "@/lib/projects/section-schemas";
import { getAllSources } from "@/lib/projects/source-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Projects.outline");
  return { title: t("sectionTitle"), robots: { index: false } };
}

const NOTICES = {
  added: "added",
  saved: "saved",
  cited: "cited",
  "citation-removed": "citationRemoved",
} as const;

export default async function ProjectSectionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/outline/[sectionId]">) {
  const { id, sectionId } = await params;
  await requireOnboardedUser(`/projects/${id}/outline/${sectionId}`);

  // La section d'un autre, d'un autre projet ou inexistante : même réponse.
  const section = await getSection(id, sectionId);
  if (!section) notFound();

  const [t, citations, sources, { notice }] = await Promise.all([
    getTranslations("Projects.outline"),
    getCitations(section.id),
    getAllSources(section.projectId),
    searchParams,
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  const byId = new Map((sources ?? []).map((source) => [source.id, source]));
  const cited = new Set(citations.map((citation) => citation.sourceId));
  const available = (sources ?? []).filter((source) => !cited.has(source.id));
  const label = (sourceId: string) => {
    const source = byId.get(sourceId);
    if (!source) return t("unknownSource");
    return [source.authors[0], source.publicationYear?.toString(), source.title]
      .filter(Boolean)
      .join(t("separator"));
  };

  return (
    <AuthPageShell
      wide
      title={section.title}
      footer={
        <p>
          <Link href={`/projects/${section.projectId}/outline`} className="underline underline-offset-4">
            {t("backToOutline")}
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
        <h2 className="text-lg font-semibold">{t("writeHeading")}</h2>
        <p className="text-sm opacity-80" data-testid="word-count">
          {t("words", { count: countWords(section.body) })}
        </p>
        <AuthForm action={updateSection} submitLabel={t("save")} pendingLabel={t("pending")}>
          <input type="hidden" name="projectId" value={section.projectId} />
          <input type="hidden" name="sectionId" value={section.id} />
          <input type="hidden" name="updatedAt" value={section.updatedAt} />
          <OptionalTextField
            name="title"
            label={t("fields.title")}
            maxLength={300}
            defaultValue={section.title}
            required
          />
          <SelectField
            name="level"
            label={t("fields.level")}
            placeholder={t("choose")}
            options={SECTION_LEVELS.map((level) => ({ value: level, label: t(`levels.${level}`) }))}
            defaultValue={String(section.level)}
            required
          />
          <OptionalTextField
            name="body"
            label={t("fields.body")}
            hint={t("fields.bodyHint")}
            maxLength={SECTION_BODY_MAX}
            rows={18}
            defaultValue={section.body ?? ""}
          />
        </AuthForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("citationsHeading", { count: citations.length })}</h2>
        <p className="text-sm opacity-80">{t("citationsIntro")}</p>
        {citations.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {citations.map((citation) => (
              <li
                key={citation.sourceId}
                data-testid="citation"
                className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
              >
                <p>
                  <Link
                    href={`/projects/${section.projectId}/sources/${citation.sourceId}`}
                    className="underline underline-offset-4"
                  >
                    {label(citation.sourceId)}
                  </Link>
                  {citation.pages ? (
                    <span className="opacity-80">
                      {t("separator")}
                      {citation.pages}
                    </span>
                  ) : null}
                </p>
                <AuthForm
                  action={removeCitation}
                  submitLabel={t("removeCitation")}
                  pendingLabel={t("pending")}
                >
                  <input type="hidden" name="projectId" value={section.projectId} />
                  <input type="hidden" name="sectionId" value={section.id} />
                  <input type="hidden" name="sourceId" value={citation.sourceId} />
                </AuthForm>
              </li>
            ))}
          </ul>
        ) : null}

        {sources === null ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {t("loadFailed")}
          </p>
        ) : sources.length === 0 ? (
          <p className="opacity-70">
            <span>{t("noSources")}</span>
            <Link
              href={`/projects/${section.projectId}/sources`}
              className="ms-1 underline underline-offset-4"
            >
              {t("toSources")}
            </Link>
          </p>
        ) : available.length > 0 ? (
          <AuthForm action={citeSource} submitLabel={t("cite")} pendingLabel={t("pending")}>
            <input type="hidden" name="projectId" value={section.projectId} />
            <input type="hidden" name="sectionId" value={section.id} />
            <SelectField
              name="sourceId"
              label={t("fields.source")}
              placeholder={t("choose")}
              options={available.map((source) => ({ value: source.id, label: label(source.id) }))}
              required
            />
            <OptionalTextField
              name="pages"
              label={t("fields.pages")}
              hint={t("fields.pagesHint")}
              maxLength={50}
            />
          </AuthForm>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("deleteHeading")}</h2>
        <p className="text-sm opacity-80">{t("deleteIntro")}</p>
        <AuthForm
          action={deleteSection}
          submitLabel={t("delete")}
          pendingLabel={t("pending")}
          destructive
        >
          <input type="hidden" name="projectId" value={section.projectId} />
          <input type="hidden" name="sectionId" value={section.id} />
          <CheckboxField name="confirm" label={t("deleteConfirm")} />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
