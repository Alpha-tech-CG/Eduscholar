import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { AccountActions } from "@/components/admin/account-actions";
import { UserLookup } from "@/components/admin/user-lookup";
import { AuthForm, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { confirmAdminIdentity } from "@/lib/admin/actions";
import { getAdminSession, listAdminAccounts } from "@/lib/admin/queries";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  confirmed: "noticeConfirmed",
  "role-granted": "noticeRoleGranted",
  "role-revoked": "noticeRoleRevoked",
  suspended: "noticeSuspended",
  restored: "noticeRestored",
} as const;

/**
 * Administration des rôles et des comptes. La page répond « introuvable » à qui
 * n'est pas administrateur ; ce n'est qu'un aiguillage, chaque opération étant
 * revérifiée par la base.
 */
export default async function AdminPage({ searchParams }: PageProps<"/[locale]/admin">) {
  await requireUser("/admin");
  const session = await getAdminSession();
  if (session.rank < 2) notFound();

  const [t, messages, { notice }] = await Promise.all([
    getTranslations("Admin"),
    getMessages(),
    searchParams,
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  if (!session.recent) {
    return (
      <AuthPageShell title={t("confirmTitle")} intro={t("confirmIntro")}>
        <AuthForm action={confirmAdminIdentity} submitLabel={t("confirm")} pendingLabel={t("pending")}>
          <TextField
            name="code"
            type="code"
            autoComplete="one-time-code"
            label={t("code")}
            hint={t("codeHint")}
          />
        </AuthForm>
      </AuthPageShell>
    );
  }

  const listing = await listAdminAccounts();
  const accounts = listing?.accounts ?? null;

  return (
    <AuthPageShell wide title={t("title")} intro={t("intro")}>
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("ruleAudit")}</li>
        <li>{t("ruleSecondFactor")}</li>
        <li>{t("ruleOwn")}</li>
        <li>{t("ruleRank")}</li>
      </ul>

      {/* Les composants client de cette page ont besoin de leurs propres textes. */}
      <NextIntlClientProvider messages={{ Admin: messages.Admin, Auth: messages.Auth }}>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("lookupHeading")}</h2>
          <UserLookup adminRank={session.rank} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("accountsHeading")}</h2>
          {accounts === null ? (
            <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
              {t("loadFailed")}
            </p>
          ) : accounts.length === 0 ? (
            <p className="opacity-70">{t("accountsEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {listing?.truncated ? (
                <li data-testid="list-truncated" className="rounded border border-foreground/30 p-3 text-sm">
                  {t("truncated")}
                </li>
              ) : null}
              {accounts.map((account) => (
                <li
                  key={account.userId}
                  data-testid="admin-account"
                  className="flex flex-col gap-3 rounded border border-foreground/20 p-3"
                >
                  <p className="break-all font-medium">{account.email}</p>
                  <p className="text-sm opacity-80">
                    {[
                      ...account.roles.map((role) => t(`roles.${role as "moderator"}`)),
                      ...(account.suspended ? [t("suspendedState")] : []),
                    ].join(t("separator"))}
                  </p>
                  {account.suspensionReason ? (
                    <p className="text-sm whitespace-pre-line">{account.suspensionReason}</p>
                  ) : null}
                  <AccountActions
                    userId={account.userId}
                    roles={account.roles}
                    suspended={account.suspended}
                    adminRank={session.rank}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </NextIntlClientProvider>
    </AuthPageShell>
  );
}
