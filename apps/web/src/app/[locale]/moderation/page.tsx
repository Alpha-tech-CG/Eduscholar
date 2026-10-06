import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { resolveReport } from "@/lib/catalogue/actions";
import { requireModerator } from "@/lib/catalogue/guard";
import { getModerationQueue, getOpenReports } from "@/lib/catalogue/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.moderation");
  return { title: t("title"), robots: { index: false } };
}

export default async function ModerationPage({
  searchParams,
}: PageProps<"/[locale]/moderation">) {
  await requireModerator("/moderation");
  const [t, tStatus, tReason, format, queue, reports, { notice }] = await Promise.all([
    getTranslations("Catalogue.moderation"),
    getTranslations("Catalogue.editorialStatus"),
    getTranslations("Catalogue.reportReason"),
    getFormatter(),
    getModerationQueue(),
    getOpenReports(),
    searchParams,
  ]);

  return (
    <AuthPageShell wide title={t("title")} intro={t("intro")}>
      {notice === "report-handled" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("reportHandled")}
        </p>
      ) : null}

      <p>
        <Link href="/moderation/import" className="underline underline-offset-4">
          {t("importLink")}
        </Link>
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("queue", { count: queue.length })}</h2>
        {queue.length === 0 ? (
          <p className="opacity-70">{t("queueEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {queue.map((resource) => (
              <li key={resource.id} className="rounded border border-foreground/20 p-3">
                <Link
                  href={`/moderation/${resource.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {resource.title}
                </Link>
                <p className="text-sm opacity-80">
                  <span>{tStatus(resource.editorialStatus as "pending")}</span>
                  <span aria-hidden="true">{t("separator")}</span>
                  <span>{resource.sourceName}</span>
                  <span aria-hidden="true">{t("separator")}</span>
                  <time dateTime={resource.createdAt}>
                    {format.dateTime(new Date(resource.createdAt), { dateStyle: "medium" })}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("reports", { count: reports.length })}</h2>
        {reports.length === 0 ? (
          <p className="opacity-70">{t("reportsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-col gap-3 rounded border border-foreground/20 p-3">
                <p className="font-medium">{tReason(report.reason as "other")}</p>
                {report.details ? <p className="whitespace-pre-line">{report.details}</p> : null}
                <p className="text-sm">
                  <Link
                    href={`/moderation/${report.resourceId}`}
                    className="underline underline-offset-4"
                  >
                    {t("openResource")}
                  </Link>
                </p>
                <AuthForm
                  action={resolveReport}
                  submitLabel={t("handleReport")}
                  pendingLabel={t("pending")}
                >
                  <input type="hidden" name="reportId" value={report.id} />
                  <SelectField
                    name="status"
                    label={t("reportDecision")}
                    placeholder={t("choose")}
                    options={[
                      { value: "resolved", label: t("reportResolved") },
                      { value: "dismissed", label: t("reportDismissed") },
                    ]}
                    required
                  />
                  <OptionalTextField name="note" label={t("reportNote")} maxLength={2000} rows={2} />
                </AuthForm>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AuthPageShell>
  );
}
