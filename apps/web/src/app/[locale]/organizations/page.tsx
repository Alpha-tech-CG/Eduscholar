import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm, CheckboxField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { leaveOrganization } from "@/lib/organizations/actions";
import { getMyOrganizations } from "@/lib/organizations/queries";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Organizations.mine");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = { joined: "noticeJoined", left: "noticeLeft" } as const;

/** Organisations dont l'utilisateur est membre : son rôle, leur état, et la sortie. */
export default async function MyOrganizationsPage({ searchParams }: PageProps<"/[locale]/organizations">) {
  await requireOnboardedUser("/organizations");
  const [t, tRoles, tStatus, format, organizations, { notice }] = await Promise.all([
    getTranslations("Organizations.mine"),
    getTranslations("Organizations.roles"),
    getTranslations("Organizations.status"),
    getFormatter(),
    getMyOrganizations(),
    searchParams,
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro")}
      footer={
        <p>
          <Link href="/account" className="underline underline-offset-4">
            {t("toAccount")}
          </Link>
        </p>
      }
    >
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      {organizations === null ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("loadFailed")}
        </p>
      ) : organizations.length === 0 ? (
        <p className="opacity-70">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {organizations.map((organization) => (
            <li
              key={organization.id}
              data-testid="my-organization"
              className="flex flex-col gap-3 rounded border border-foreground/20 p-3"
            >
              <h2 className="font-medium break-words">{organization.name}</h2>
              <p className="text-sm opacity-80">
                {[
                  tRoles(organization.role),
                  tStatus(organization.status),
                  t("since", { date: format.dateTime(new Date(organization.joinedAt), { dateStyle: "long" }) }),
                ].join(t("separator"))}
              </p>
              {organization.status === "suspended" ? (
                <p className="text-sm">{t("suspendedHelp")}</p>
              ) : organization.role === "org_admin" ? (
                // Un simple lien : la page d'administration est gardée par la base.
                <p>
                  <Link href={`/organizations/${organization.id}`} className="inline-block py-2 underline underline-offset-4">
                    {t("manage")}
                  </Link>
                </p>
              ) : null}
              <details>
                <summary className="cursor-pointer py-2 underline underline-offset-4">{t("leaveSummary")}</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-sm opacity-80">{t("leaveHelp")}</p>
                  <AuthForm action={leaveOrganization} submitLabel={t("leave")} pendingLabel={t("pending")} destructive>
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <CheckboxField name="confirm" label={t("leaveConfirm")} />
                  </AuthForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </AuthPageShell>
  );
}
