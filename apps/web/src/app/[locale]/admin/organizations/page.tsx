import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  AuthForm,
  CheckboxField,
  OptionalTextField,
  SelectField,
  TextField,
} from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { confirmAdminIdentity } from "@/lib/admin/actions";
import { getAdminSession } from "@/lib/admin/queries";
import { requireUser } from "@/lib/auth/session";
import {
  createOrganization,
  dissolveOrganization,
  inviteOrganizationAdmin,
  renameOrganization,
  setOrganizationStatus,
} from "@/lib/organizations/admin-actions";
import { listOrganizations } from "@/lib/organizations/queries";
import { organizationPage } from "@/lib/organizations/schemas";
import { getReferenceData } from "@/lib/profile/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Organizations.admin");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  confirmed: "noticeConfirmed",
  created: "noticeCreated",
  verified: "noticeVerified",
  suspended: "noticeSuspended",
  restored: "noticeRestored",
  renamed: "noticeRenamed",
  dissolved: "noticeDissolved",
  "admin-invited": "noticeAdminInvited",
  "admin-invited-not-sent": "noticeAdminInvitedNotSent",
} as const;

/**
 * Administration des organisations par la plateforme. La page répond
 * « introuvable » à qui n'est pas administrateur ; ce n'est qu'un aiguillage,
 * chaque opération étant revérifiée par la base. Les formulaires proposés
 * selon l'état d'une organisation ne sont qu'un confort : la base refuse toute
 * opération qui n'est pas permise à l'appelant.
 */
export default async function AdminOrganizationsPage({
  searchParams,
}: PageProps<"/[locale]/admin/organizations">) {
  await requireUser("/admin/organizations");
  const session = await getAdminSession();
  if (session.rank < 2) notFound();

  const [t, tAdmin, { notice, page }] = await Promise.all([
    getTranslations("Organizations.admin"),
    getTranslations("Admin"),
    searchParams,
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  if (!session.recent) {
    return (
      <AuthPageShell title={tAdmin("confirmTitle")} intro={tAdmin("confirmIntro")}>
        <AuthForm action={confirmAdminIdentity} submitLabel={tAdmin("confirm")} pendingLabel={tAdmin("pending")}>
          <input type="hidden" name="from" value="organizations" />
          <TextField
            name="code"
            type="code"
            autoComplete="one-time-code"
            label={tAdmin("code")}
            hint={tAdmin("codeHint")}
          />
        </AuthForm>
      </AuthPageShell>
    );
  }

  const [locale, format, tStatus] = await Promise.all([
    getLocale(),
    getFormatter(),
    getTranslations("Organizations.status"),
  ]);
  const [listing, reference] = await Promise.all([
    listOrganizations(organizationPage(page)),
    getReferenceData(locale),
  ]);
  const organizations = listing?.organizations ?? null;
  const currentPage = String(listing?.page ?? 1);
  const pending = t("pending");

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/admin" className="underline underline-offset-4">
            {t("backToAdmin")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("ruleAudit")}</li>
        <li>{t("ruleOwn")}</li>
        <li data-testid="recovery-rule">{t("ruleRecovery")}</li>
      </ul>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("listHeading")}</h2>
        {organizations === null ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {t("loadFailed")}
          </p>
        ) : organizations.length === 0 ? (
          <p className="opacity-70">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {organizations.map((organization) => {
              const suspended = organization.status === "suspended";
              const hidden = (
                <>
                  <input type="hidden" name="organizationId" value={organization.id} />
                  <input type="hidden" name="page" value={currentPage} />
                </>
              );
              return (
                <li
                  key={organization.id}
                  data-testid="organization"
                  className="flex flex-col gap-3 rounded border border-foreground/20 p-3"
                >
                  <h3 className="font-medium break-words">{organization.name}</h3>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="opacity-70">{t("slug")}</dt>
                    <dd className="break-all">
                      <code>{organization.slug}</code>
                    </dd>
                    <dt className="opacity-70">{t("state")}</dt>
                    <dd data-testid="organization-status">{tStatus(organization.status)}</dd>
                    <dt className="opacity-70">{t("members")}</dt>
                    <dd data-testid="organization-counts">
                      {t("counts", { members: organization.memberCount, admins: organization.adminCount })}
                    </dd>
                    {organization.countryCode ? (
                      <>
                        <dt className="opacity-70">{t("country")}</dt>
                        <dd>
                          {reference.countries.find(({ code }) => code === organization.countryCode)?.label ??
                            organization.countryCode}
                        </dd>
                      </>
                    ) : null}
                    <dt className="opacity-70">{t("createdAt")}</dt>
                    <dd>{format.dateTime(new Date(organization.createdAt), { dateStyle: "long" })}</dd>
                  </dl>

                  {suspended ? (
                    <div className="flex flex-col gap-1 text-sm">
                      <p className="font-medium">{t("suspensionReason")}</p>
                      <p className="whitespace-pre-line break-words">
                        {organization.suspensionReason ?? t("suspensionReasonUnknown")}
                      </p>
                    </div>
                  ) : null}
                  {organization.recoverySinceSuspension ? (
                    <p
                      data-testid="recovery-signal"
                      className="rounded border-2 border-foreground/60 p-3 text-sm font-medium"
                    >
                      {t("recoverySignal")}
                    </p>
                  ) : null}

                  {organization.status === "pending" ? (
                    <AuthForm action={setOrganizationStatus} submitLabel={t("verify")} pendingLabel={pending}>
                      {hidden}
                      <input type="hidden" name="intent" value="verify" />
                      <input type="hidden" name="reason" value="" />
                    </AuthForm>
                  ) : null}

                  {suspended ? (
                    <details>
                      <summary className="cursor-pointer py-2 underline underline-offset-4">{t("restoreSummary")}</summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <p className="text-sm opacity-80">{t("restoreHelp")}</p>
                        <AuthForm action={setOrganizationStatus} submitLabel={t("restore")} pendingLabel={pending}>
                          {hidden}
                          <input type="hidden" name="intent" value="restore" />
                          <OptionalTextField
                            name="reason"
                            label={t("reason")}
                            hint={t("restoreReasonHint")}
                            maxLength={500}
                            rows={2}
                            required
                          />
                        </AuthForm>
                      </div>
                    </details>
                  ) : (
                    <details>
                      <summary className="cursor-pointer py-2 underline underline-offset-4">{t("suspendSummary")}</summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <p className="text-sm opacity-80">{t("suspendHelp")}</p>
                        <AuthForm
                          action={setOrganizationStatus}
                          submitLabel={t("suspend")}
                          pendingLabel={pending}
                          destructive
                        >
                          {hidden}
                          <input type="hidden" name="intent" value="suspend" />
                          <OptionalTextField
                            name="reason"
                            label={t("reason")}
                            hint={t("suspendReasonHint")}
                            maxLength={500}
                            rows={2}
                            required
                          />
                        </AuthForm>
                      </div>
                    </details>
                  )}

                  {suspended || organization.adminCount === 0 ? (
                    <details>
                      <summary className="cursor-pointer py-2 underline underline-offset-4">
                        {t(suspended ? "inviteRecoverySummary" : "inviteAdminSummary")}
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <p className="text-sm opacity-80">{t(suspended ? "inviteRecoveryHelp" : "inviteAdminHelp")}</p>
                        <AuthForm action={inviteOrganizationAdmin} submitLabel={t("inviteAdmin")} pendingLabel={pending}>
                          {hidden}
                          <OptionalTextField
                            name="email"
                            label={t("inviteEmail")}
                            hint={t("inviteEmailHint")}
                            maxLength={254}
                            required
                          />
                        </AuthForm>
                      </div>
                    </details>
                  ) : null}

                  <details>
                    <summary className="cursor-pointer py-2 underline underline-offset-4">{t("renameSummary")}</summary>
                    <div className="mt-3 flex flex-col gap-3">
                      {organization.status === "verified" ? (
                        <p className="rounded border border-foreground/40 p-3 text-sm">{t("renameWarning")}</p>
                      ) : null}
                      <AuthForm action={renameOrganization} submitLabel={t("rename")} pendingLabel={pending}>
                        {hidden}
                        <OptionalTextField
                          name="name"
                          label={t("name")}
                          defaultValue={organization.name}
                          maxLength={200}
                          required
                        />
                        <OptionalTextField
                          name="slug"
                          label={t("slug")}
                          hint={t("slugHint")}
                          defaultValue={organization.slug}
                          maxLength={80}
                          required
                        />
                      </AuthForm>
                    </div>
                  </details>

                  {suspended ? (
                    <details>
                      <summary className="cursor-pointer py-2 underline underline-offset-4">{t("dissolveSummary")}</summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <p className="text-sm opacity-80">{t("dissolveHelp")}</p>
                        <AuthForm
                          action={dissolveOrganization}
                          submitLabel={t("dissolve")}
                          pendingLabel={pending}
                          destructive
                        >
                          {hidden}
                          <OptionalTextField
                            name="reason"
                            label={t("reason")}
                            hint={t("dissolveReasonHint")}
                            maxLength={500}
                            rows={2}
                            required
                          />
                          <CheckboxField name="confirm" label={t("dissolveConfirm")} />
                        </AuthForm>
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {listing && (listing.page > 1 || listing.hasNext) ? (
          <nav aria-label={t("pagination.label")} className="flex flex-wrap items-center gap-4 text-sm">
            {listing.page > 1 ? (
              <Link
                href={{ pathname: "/admin/organizations", query: { page: String(listing.page - 1) } }}
                className="py-3 underline underline-offset-4"
              >
                {t("pagination.previous")}
              </Link>
            ) : null}
            <span data-testid="organizations-page">{t("pagination.page", { page: listing.page })}</span>
            {listing.hasNext ? (
              <Link
                href={{ pathname: "/admin/organizations", query: { page: String(listing.page + 1) } }}
                className="py-3 underline underline-offset-4"
              >
                {t("pagination.next")}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("createHeading")}</h2>
        <p className="text-sm opacity-80">{t("createIntro")}</p>
        <AuthForm action={createOrganization} submitLabel={t("create")} pendingLabel={pending}>
          <OptionalTextField name="name" label={t("name")} maxLength={200} required />
          <OptionalTextField name="slug" label={t("slug")} hint={t("slugHint")} maxLength={80} required />
          <SelectField
            name="countryCode"
            label={t("countryOptional")}
            placeholder={t("noCountry")}
            options={reference.countries.map(({ code, label }) => ({ value: code, label }))}
          />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
