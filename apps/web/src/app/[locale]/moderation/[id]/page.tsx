import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { ResourceSummary } from "@/components/catalogue/resource-summary";
import { Link } from "@/i18n/navigation";
import { moderateResource, moderatorUpdateResource } from "@/lib/catalogue/actions";
import { requireModerator } from "@/lib/catalogue/guard";
import {
  getCatalogueReference,
  getInternalNotes,
  getResource,
  getResourceHistory,
} from "@/lib/catalogue/queries";
import {
  ACCESS_STATUSES,
  MODERATION_ACTIONS,
  type ModerationAction,
} from "@/lib/catalogue/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.moderation");
  return { title: t("detailTitle"), robots: { index: false } };
}

// Transitions proposées selon le statut. La base est seule à décider : cette
// table ne sert qu'à ne pas proposer une action qu'elle refuserait.
const AVAILABLE: Record<string, ModerationAction[]> = {
  pending: ["start_review", "request_changes", "reject"],
  under_review: ["verify", "request_changes", "reject"],
  changes_requested: ["reject"],
  verified: ["publish", "reject", "remove"],
  published: ["suspend", "remove"],
  suspended: ["restore", "remove"],
};

const NOTICES: ReadonlySet<string> = new Set([...MODERATION_ACTIONS, "edited"]);

export default async function ModerationResourcePage({
  params,
  searchParams,
}: PageProps<"/[locale]/moderation/[id]">) {
  const { id } = await params;
  await requireModerator(`/moderation/${id}`);

  const resource = await getResource(id);
  if (!resource || resource.visibility !== "public") notFound();

  const locale = await getLocale();
  const [t, tStatus, tAction, tHistory, tAccess, format, notes, history, catalogue, { notice }] =
    await Promise.all([
      getTranslations("Catalogue.moderation"),
      getTranslations("Catalogue.editorialStatus"),
      getTranslations("Catalogue.moderationAction"),
      getTranslations("Catalogue.historyAction"),
      getTranslations("Catalogue.accessStatus"),
      getFormatter(),
      getInternalNotes(resource.id),
      getResourceHistory(resource.id),
      getCatalogueReference(locale),
      searchParams,
    ]);

  const actions = AVAILABLE[resource.editorialStatus] ?? [];
  const noticeKey = typeof notice === "string" && NOTICES.has(notice) ? notice : null;
  const editable = !["rejected", "removed"].includes(resource.editorialStatus);

  return (
    <AuthPageShell
      wide
      title={resource.title}
      footer={
        <p>
          <Link href="/moderation" className="underline underline-offset-4">
            {t("back")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("decisionRecorded")}
        </p>
      ) : null}

      <p className="font-medium">
        <span>{t("statusLabel")}</span>
        <span data-testid="resource-status">{tStatus(resource.editorialStatus as "pending")}</span>
      </p>

      <ResourceSummary resource={resource} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("internal")}</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
          <dt className="text-sm opacity-70">{t("rightsDeclared")}</dt>
          <dd>
            {notes?.rightsDeclaredAt
              ? format.dateTime(new Date(notes.rightsDeclaredAt), { dateStyle: "long" })
              : t("none")}
          </dd>
          <dt className="text-sm opacity-70">{t("permissionProof")}</dt>
          <dd className="whitespace-pre-line break-words">{notes?.permissionProof ?? t("none")}</dd>
          <dt className="text-sm opacity-70">{t("contributorComment")}</dt>
          <dd className="whitespace-pre-line break-words">
            {notes?.contributorComment ?? t("none")}
          </dd>
        </dl>
      </section>

      {actions.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("decision")}</h2>
          <AuthForm action={moderateResource} submitLabel={t("apply")} pendingLabel={t("pending")}>
            <input type="hidden" name="resourceId" value={resource.id} />
            <SelectField
              name="action"
              label={t("action")}
              placeholder={t("choose")}
              options={actions.map((action) => ({ value: action, label: tAction(action) }))}
              required
            />
            <OptionalTextField
              name="reason"
              label={t("reason")}
              hint={t("reasonHint")}
              maxLength={2000}
              rows={3}
            />
          </AuthForm>
        </section>
      ) : null}

      {editable ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("correct")}</h2>
          <p className="text-sm opacity-80">{t("correctIntro")}</p>
          <AuthForm
            action={moderatorUpdateResource}
            submitLabel={t("saveCorrection")}
            pendingLabel={t("pending")}
          >
            <input type="hidden" name="resourceId" value={resource.id} />
            <OptionalTextField
              name="officialUrl"
              label={t("officialUrl")}
              defaultValue={resource.officialUrl ?? undefined}
              maxLength={2000}
              kind="url"
              required
            />
            <SelectField
              name="accessStatus"
              label={t("accessStatus")}
              placeholder={t("choose")}
              options={ACCESS_STATUSES.map((value) => ({ value, label: tAccess(value) }))}
              defaultValue={resource.accessStatus}
              required
            />
            <SelectField
              name="licenseCode"
              label={t("license")}
              placeholder={t("choose")}
              options={catalogue.licenses.map((item) => ({ value: item.code, label: item.label }))}
              defaultValue={resource.licenseCode}
              required
            />
            <OptionalTextField
              name="moderationNotes"
              label={t("notes")}
              hint={t("notesHint")}
              defaultValue={notes?.moderationNotes ?? undefined}
              maxLength={5000}
              rows={3}
            />
          </AuthForm>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("history")}</h2>
        <ol className="flex flex-col gap-2">
          {history.map((entry) => (
            <li key={entry.id} className="rounded border border-foreground/20 p-3 text-sm">
              <p className="font-medium">
                <span>{tHistory(entry.action as "submitted")}</span>
                <span aria-hidden="true">{t("separator")}</span>
                <time dateTime={entry.occurredAt}>
                  {format.dateTime(new Date(entry.occurredAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </p>
              {entry.reason ? <p>{entry.reason}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </AuthPageShell>
  );
}
