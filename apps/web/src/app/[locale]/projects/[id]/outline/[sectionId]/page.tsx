import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, CheckboxField, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { CommentThreads } from "@/components/projects/comment-threads";
import { SectionEditor } from "@/components/projects/section-editor";
import { requireOnboardedUser } from "@/lib/profile/guard";
import {
  citeSource,
  deleteSection,
  removeCitation,
} from "@/lib/projects/section-actions";
import { getProjectComments } from "@/lib/projects/comment-queries";
import { getCitations, getSection } from "@/lib/projects/section-queries";
import { SECTION_LEVELS } from "@/lib/projects/section-schemas";
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
  commented: "commented",
  replied: "replied",
  "comment-deleted": "commentDeleted",
  resolved: "threadResolved",
  reopened: "threadReopened",
} as const;

export default async function ProjectSectionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/outline/[sectionId]">) {
  const { id, sectionId } = await params;
  const { user } = await requireOnboardedUser(`/projects/${id}/outline/${sectionId}`);

  // La section d'un autre, d'un autre projet ou inexistante : même réponse.
  const section = await getSection(id, sectionId);
  if (!section) notFound();

  const [t, tAuth, comments, citations, sources, { notice }] = await Promise.all([
    getTranslations("Projects.outline"),
    getTranslations("Auth"),
    getProjectComments(section.projectId),
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
        <SectionEditor
          projectId={section.projectId}
          sectionId={section.id}
          editorId={user.id}
          initial={{
            title: section.title,
            level: String(section.level),
            body: section.body ?? "",
            updatedAt: section.updatedAt,
          }}
          labels={{
            title: t("fields.title"),
            level: t("fields.level"),
            choose: t("choose"),
            levels: SECTION_LEVELS.map((level) => ({ value: level, label: t(`levels.${level}`) })),
            body: t("fields.body"),
            bodyHint: t("fields.bodyHint"),
            save: t("save"),
            pending: t("pending"),
            words: {
              zero: t("words", { count: 0 }),
              one: t("words", { count: 1 }),
              other: t.raw("wordsMany") as string,
            },
            status: {
              unsaved: t("autosave.unsaved"),
              saving: t("autosave.saving"),
              savedAt: t.raw("autosave.savedAt") as string,
              retrying: t("autosave.retrying"),
              offline: t("autosave.offline"),
              unreachable: t("autosave.unreachable"),
            },
            network: t("autosave.network"),
            errors: {
              validation: tAuth("errors.validation"),
              rate_limited: t("autosave.rateLimited"),
              limit_reached: t("autosave.limitReached"),
              session_expired: t("autosave.sessionExpired"),
              not_found: t("autosave.notFound"),
              forbidden: t("autosave.forbidden"),
              unavailable: t("autosave.unavailable"),
            },
            fieldErrors: {
              required: tAuth("fieldErrors.required"),
              too_long: tAuth("fieldErrors.too_long"),
              invalid_choice: tAuth("fieldErrors.invalid_choice"),
            },
            leave: t("autosave.leave"),
            conflict: {
              heading: t("conflict.heading"),
              intro: t("conflict.intro"),
              theirTitle: t("conflict.theirTitle"),
              theirLevel: t("conflict.theirLevel"),
              theirs: t("conflict.theirs"),
              keepMine: t("conflict.keepMine"),
              takeTheirs: t("conflict.takeTheirs"),
              gone: t("conflict.gone"),
              reload: tAuth("errors.conflict"),
            },
          }}
        />
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

      {comments ? (
        <CommentThreads
          scope="owner"
          projectId={section.projectId}
          sectionId={section.id}
          role={comments.role}
          threads={comments.bySection.get(section.id) ?? []}
        />
      ) : null}

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
