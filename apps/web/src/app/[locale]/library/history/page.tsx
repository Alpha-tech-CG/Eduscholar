import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm, CheckboxField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { clearResourceViews, deleteResourceView, setHistoryEnabled } from "@/lib/library/actions";
import { getHistory, isHistoryEnabled } from "@/lib/library/history";
import { parsePage } from "@/lib/library/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Library.history");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  "entry-deleted": "entryDeleted",
  cleared: "cleared",
  enabled: "enabledNotice",
  disabled: "disabledNotice",
} as const;

export default async function HistoryPage({ searchParams }: PageProps<"/[locale]/library/history">) {
  await requireOnboardedUser("/library/history");
  const { notice, page } = await searchParams;
  const [t, tLibrary, format, enabled, history] = await Promise.all([
    getTranslations("Library.history"),
    getTranslations("Library"),
    getFormatter(),
    isHistoryEnabled(),
    getHistory(parsePage(page)),
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;
  const pageHref = (target: number) =>
    target > 1 ? { pathname: "/library/history", query: { page: String(target) } } : "/library/history";

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/library" className="underline underline-offset-4">
            {tLibrary("backToLibrary")}
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
        <h2 className="text-lg font-semibold">{t("settingHeading")}</h2>
        <p data-testid="history-state" className="text-sm opacity-80">
          {enabled ? t("isEnabled") : t("isDisabled")}
        </p>
        <AuthForm
          action={setHistoryEnabled}
          submitLabel={enabled ? t("disable") : t("enable")}
          pendingLabel={tLibrary("pending")}
        >
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
        </AuthForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("list", { count: history.total })}</h2>
        {history.failed ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {tLibrary("loadFailed")}
          </p>
        ) : history.entries.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ul data-testid="history-list" className="flex flex-col gap-3">
            {history.entries.map((entry) => (
              <li key={entry.resourceId} className="flex flex-col gap-2 rounded border border-foreground/20 p-3">
                {entry.resource ? (
                  <Link href={`/resources/${entry.resourceId}`} className="font-medium underline underline-offset-4">
                    {entry.resource.title}
                  </Link>
                ) : (
                  <p className="opacity-80">{tLibrary("unavailable")}</p>
                )}
                <p className="text-sm opacity-70">
                  {t("viewedAt", {
                    date: format.dateTime(new Date(entry.viewedAt), { dateStyle: "long", timeStyle: "short" }),
                  })}
                </p>
                <AuthForm action={deleteResourceView} submitLabel={t("deleteEntry")} pendingLabel={tLibrary("pending")}>
                  <input type="hidden" name="resourceId" value={entry.resourceId} />
                </AuthForm>
              </li>
            ))}
          </ul>
        )}
        {history.lastPage > 1 ? (
          <nav aria-label={tLibrary("pagination")} className="flex items-center justify-between gap-4">
            {history.page > 1 ? (
              <Link href={pageHref(history.page - 1)} className="underline underline-offset-4">
                {tLibrary("previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm opacity-70">
              {tLibrary("page", { page: history.page, pages: history.lastPage })}
            </span>
            {history.page < history.lastPage ? (
              <Link href={pageHref(history.page + 1)} className="underline underline-offset-4">
                {tLibrary("next")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      {history.total > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("clearHeading")}</h2>
          <AuthForm action={clearResourceViews} submitLabel={t("clear")} pendingLabel={tLibrary("pending")} destructive>
            <CheckboxField name="confirm" label={t("clearConfirm")} />
          </AuthForm>
        </section>
      ) : null}
    </AuthPageShell>
  );
}
