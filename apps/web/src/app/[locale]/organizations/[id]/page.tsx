import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import {
  inviteOrgMember,
  removeOrgMember,
  revokeOrgInvitation,
  setOrgMemberRole,
} from "@/lib/organizations/actions";
import { getMyOrganizations, getOrganizationMembers } from "@/lib/organizations/queries";
import { ORG_ROLES, ORG_UUID } from "@/lib/organizations/schemas";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Organizations.manage");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  invited: "noticeInvited",
  "invited-not-sent": "noticeInvitedNotSent",
  revoked: "noticeRevoked",
  removed: "noticeRemoved",
  "role-changed": "noticeRoleChanged",
} as const;

/** Membres et invitations d'une organisation. Réservé à son administrateur. */
export default async function OrganizationPage({
  params,
  searchParams,
}: PageProps<"/[locale]/organizations/[id]">) {
  const { id } = await params;
  const { user } = await requireOnboardedUser(ORG_UUID.test(id) ? `/organizations/${id}` : "/organizations");

  // Une organisation inexistante, suspendue, celle d'un autre, ou dont on
  // n'est que simple membre : même réponse. C'est la base qui tranche, à la
  // lecture des membres ; sa propre appartenance ne donne que le nom à afficher.
  const [loaded, mine] = await Promise.all([getOrganizationMembers(id), getMyOrganizations()]);
  const organization = mine?.find((entry) => entry.id === id);
  if (loaded.status === "not_found" || !organization) notFound();

  const [t, tRoles, format, { notice }] = await Promise.all([
    getTranslations("Organizations.manage"),
    getTranslations("Organizations.roles"),
    getFormatter(),
    searchParams,
  ]);
  const footer = (
    <p>
      <Link href="/organizations" className="underline underline-offset-4">
        {t("toMine")}
      </Link>
    </p>
  );

  if (loaded.status === "rate_limited") {
    return (
      <AuthPageShell wide title={organization.name} footer={footer}>
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("rateLimited")}
        </p>
      </AuthPageShell>
    );
  }

  const { members, invitations, platformInvitationPending } = loaded.data;
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "long" });
  const roleOptions = ORG_ROLES.map((role) => ({ value: role, label: tRoles(role) }));

  return (
    <AuthPageShell wide title={organization.name} intro={t("intro")} footer={footer}>
      {noticeKey ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t(noticeKey)}
        </p>
      ) : null}

      {platformInvitationPending ? (
        <p data-testid="platform-invitation" className="rounded border-2 border-foreground/60 p-3 font-medium">
          {t("platformInvitationPending")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("members", { count: members.length })}</h2>
        {members.length === 0 ? (
          <p className="opacity-70">{t("membersEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {members.map((member) => {
              const own = member.userId === user.id;
              return (
                <li
                  key={member.userId}
                  data-testid="org-member"
                  className="flex flex-col gap-3 rounded border border-foreground/20 p-3"
                >
                  <p>
                    <span className="font-medium break-all">{member.email ?? t("unknownMember")}</span>
                    <span className="opacity-80">
                      {own ? `${t("separator")}${t("you")}` : ""}
                      {t("separator")}
                      <span data-testid="org-member-role">{tRoles(member.role)}</span>
                      {t("separator")}
                      {t("since", { date: day(member.joinedAt) })}
                    </span>
                  </p>
                  {own ? (
                    <p className="text-sm opacity-80">{t("ownRowHelp")}</p>
                  ) : (
                    <>
                      <AuthForm action={setOrgMemberRole} submitLabel={t("changeRole")} pendingLabel={t("pending")}>
                        <input type="hidden" name="organizationId" value={id} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <SelectField
                          name="role"
                          label={t("roleOf", { email: member.email ?? t("unknownMember") })}
                          placeholder={t("choose")}
                          options={roleOptions}
                          defaultValue={member.role}
                          required
                        />
                      </AuthForm>
                      <AuthForm action={removeOrgMember} submitLabel={t("remove")} pendingLabel={t("pending")} destructive>
                        <input type="hidden" name="organizationId" value={id} />
                        <input type="hidden" name="userId" value={member.userId} />
                      </AuthForm>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("invitations", { count: invitations.length })}</h2>
        {invitations.length === 0 ? (
          <p className="opacity-70">{t("invitationsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                data-testid="org-invitation"
                className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
              >
                <p>
                  <span className="font-medium break-all">{invitation.email}</span>
                  <span className="opacity-80">
                    {t("separator")}
                    {tRoles(invitation.role)}
                    {t("separator")}
                    {t("expires", { date: day(invitation.expiresAt) })}
                  </span>
                </p>
                <AuthForm action={revokeOrgInvitation} submitLabel={t("revoke")} pendingLabel={t("pending")}>
                  <input type="hidden" name="organizationId" value={id} />
                  <input type="hidden" name="invitationId" value={invitation.id} />
                </AuthForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("inviteHeading")}</h2>
        <p className="text-sm opacity-80">{t("inviteIntro")}</p>
        <AuthForm action={inviteOrgMember} submitLabel={t("invite")} pendingLabel={t("pending")}>
          <input type="hidden" name="organizationId" value={id} />
          <OptionalTextField name="email" label={t("inviteEmail")} maxLength={254} required />
          <SelectField
            name="role"
            label={t("inviteRole")}
            placeholder={t("choose")}
            options={roleOptions}
            defaultValue="member"
            required
          />
        </AuthForm>
        <p className="text-sm opacity-80">{t("adminRoleHelp")}</p>
      </section>
    </AuthPageShell>
  );
}
