import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { markNotificationsRead } from "@/lib/notifications/actions";
import { getNotifications } from "@/lib/notifications/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications");
  return { title: t("title"), robots: { index: false } };
}

/** Ce qui s'est passé sur les projets que l'utilisateur écrit ou suit. */
export default async function NotificationsPage({ searchParams }: PageProps<"/[locale]/notifications">) {
  await requireOnboardedUser("/notifications");
  const [t, format, notifications, { notice }] = await Promise.all([
    getTranslations("Notifications"),
    getFormatter(),
    getNotifications(),
    searchParams,
  ]);
  const unread = (notifications ?? []).filter((notification) => !notification.read).length;

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/account" className="underline underline-offset-4">
            {t("backToAccount")}
          </Link>
        </p>
      }
    >
      {notice === "read" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("noticeRead")}
        </p>
      ) : null}

      {notifications === null ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("loadFailed")}
        </p>
      ) : notifications.length === 0 ? (
        <p className="opacity-70">{t("empty")}</p>
      ) : (
        <>
          <p data-testid="unread-count">{t("unread", { count: unread })}</p>
          <ul className="flex flex-col gap-3">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                data-testid="notification"
                data-read={notification.read ? "true" : "false"}
                className="flex flex-col gap-1 rounded border border-foreground/20 p-3"
              >
                <p className={notification.read ? "opacity-80" : "font-medium"}>
                  <Link href={notification.href} className="underline underline-offset-4">
                    {t(`kinds.${notification.kind}`, { project: notification.projectTitle })}
                  </Link>
                </p>
                <p className="text-sm opacity-80">
                  {[
                    format.dateTime(new Date(notification.createdAt), { dateStyle: "long", timeStyle: "short" }),
                    notification.read ? t("read") : t("new"),
                  ].join(t("separator"))}
                </p>
              </li>
            ))}
          </ul>
          {unread > 0 ? (
            <AuthForm action={markNotificationsRead} submitLabel={t("markRead")} pendingLabel={t("pending")}>
              <input type="hidden" name="all" value="1" />
            </AuthForm>
          ) : null}
        </>
      )}
    </AuthPageShell>
  );
}
