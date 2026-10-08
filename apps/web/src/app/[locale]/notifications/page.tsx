import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { markNotificationsRead, setEmailDigest } from "@/lib/notifications/actions";
import { getEmailDigestPreference, getNotifications } from "@/lib/notifications/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications");
  return { title: t("title"), robots: { index: false } };
}

/** Ce qui s'est passé sur les projets que l'utilisateur écrit ou suit. */
export default async function NotificationsPage({ searchParams }: PageProps<"/[locale]/notifications">) {
  await requireOnboardedUser("/notifications");
  const [t, format, notifications, emailDigest, { notice }] = await Promise.all([
    getTranslations("Notifications"),
    getFormatter(),
    getNotifications(),
    getEmailDigestPreference(),
    searchParams,
  ]);
  const notices: Record<string, string> = {
    read: t("noticeRead"),
    "email-on": t("email.noticeOn"),
    "email-off": t("email.noticeOff"),
  };
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
      {typeof notice === "string" && notices[notice] ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {notices[notice]}
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

      {emailDigest === null ? null : (
        <section aria-labelledby="email-digest" className="flex flex-col gap-3 border-t border-foreground/20 pt-6">
          <h2 id="email-digest" className="text-lg font-medium">
            {t("email.title")}
          </h2>
          <p data-testid="email-digest-state">{emailDigest ? t("email.on") : t("email.off")}</p>
          <p className="text-sm opacity-80">{t("email.hint")}</p>
          <AuthForm
            action={setEmailDigest}
            submitLabel={emailDigest ? t("email.disable") : t("email.enable")}
            pendingLabel={t("pending")}
          >
            <input type="hidden" name="enabled" value={emailDigest ? "false" : "true"} />
          </AuthForm>
        </section>
      )}
    </AuthPageShell>
  );
}
