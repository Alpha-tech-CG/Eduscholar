import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { resolveReport } from "@/lib/catalogue/actions";
import { requireModerator } from "@/lib/catalogue/guard";
import {
  getModerationQueue,
  getOpenReports,
  MODERATION_PAGE_SIZE,
} from "@/lib/catalogue/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalogue.moderation");
  return { title: t("title"), robots: { index: false } };
}

export default async function ModerationPage({
  searchParams,
}: PageProps<"/[locale]/moderation">) {
  await requireModerator("/moderation");
  const { notice, q, page: rawPage, rpage: rawReportPage } = await searchParams;
  const words = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 200) ?? "";
  const pageNumber = (raw: string | string[] | undefined) => {
    const requested = Number.parseInt((Array.isArray(raw) ? raw[0] : raw) ?? "", 10);
    return Number.isInteger(requested) && requested >= 1 ? Math.min(requested, 500) : 1;
  };
  const wanted = pageNumber(rawPage);

  const [t, tStatus, tReason, format, result, openReports] = await Promise.all([
    getTranslations("Catalogue.moderation"),
    getTranslations("Catalogue.editorialStatus"),
    getTranslations("Catalogue.reportReason"),
    getFormatter(),
    getModerationQueue(words, wanted),
    getOpenReports(pageNumber(rawReportPage)),
  ]);
  const { resources: queue, total, page } = result;
  const lastPage = Math.max(1, Math.ceil(total / MODERATION_PAGE_SIZE));
  const { reports, total: reportTotal, page: reportPage } = openReports;
  const lastReportPage = Math.max(1, Math.ceil(reportTotal / MODERATION_PAGE_SIZE));
  // Chaque liste garde sa page quand l'autre change.
  const pageHref = (target: number, reportTarget: number = reportPage) => ({
    pathname: "/moderation" as const,
    query: {
      ...(words ? { q: words } : {}),
      ...(target > 1 ? { page: String(target) } : {}),
      ...(reportTarget > 1 ? { rpage: String(reportTarget) } : {}),
    },
  });

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
        <h2 className="text-lg font-semibold">{t("queue", { count: total })}</h2>
        <form method="get" role="search" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="q" className="text-sm font-medium">
              {t("filter")}
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={words}
              maxLength={200}
              autoComplete="off"
              className="rounded border border-foreground/30 bg-background px-3 py-2"
            />
          </div>
          <button type="submit" className="rounded border border-foreground/30 px-4 py-2 font-medium">
            {t("filterSubmit")}
          </button>
        </form>
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
        {lastPage > 1 ? (
          <nav aria-label={t("pagination")} className="flex items-center justify-between gap-4">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="underline underline-offset-4">
                {t("previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm opacity-70">{t("page", { page, pages: lastPage })}</span>
            {page < lastPage ? (
              <Link href={pageHref(page + 1)} className="underline underline-offset-4">
                {t("next")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("reports", { count: reportTotal })}</h2>
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
        {lastReportPage > 1 ? (
          <nav aria-label={t("reportsPagination")} className="flex items-center justify-between gap-4">
            {reportPage > 1 ? (
              <Link href={pageHref(page, reportPage - 1)} className="underline underline-offset-4">
                {t("previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm opacity-70" data-testid="reports-page">
              {t("page", { page: reportPage, pages: lastReportPage })}
            </span>
            {reportPage < lastReportPage ? (
              <Link href={pageHref(page, reportPage + 1)} className="underline underline-offset-4">
                {t("next")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </AuthPageShell>
  );
}
