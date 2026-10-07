import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, OptionalTextField, SelectField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";
import { inviteMember, removeMember, revokeInvitation } from "@/lib/projects/sharing-actions";
import { getProjectSharing, MEMBER_ROLES } from "@/lib/projects/sharing-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Sharing");
  return { title: t("title"), robots: { index: false } };
}

const NOTICES = {
  invited: "noticeInvited",
  "invited-not-sent": "noticeInvitedNotSent",
  revoked: "noticeRevoked",
  removed: "noticeRemoved",
} as const;

/** Partage d'un projet : qui le suit, qui est invité. Réservé à son propriétaire. */
export default async function ProjectSharingPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[id]/sharing">) {
  const { id } = await params;
  await requireOnboardedUser(`/projects/${id}/sharing`);

  // Le projet d'un autre et un projet inexistant répondent de la même façon.
  const project = await getProject(id);
  const sharing = project ? await getProjectSharing(project.id) : null;
  if (!project || !sharing) notFound();

  const [t, format, { notice }] = await Promise.all([
    getTranslations("Sharing"),
    getFormatter(),
    searchParams,
  ]);
  const noticeKey =
    typeof notice === "string" && Object.hasOwn(NOTICES, notice)
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "long" });

  return (
    <AuthPageShell
      wide
      title={t("title")}
      intro={t("intro", { project: project.title })}
      footer={
        <p>
          <Link href={`/projects/${project.id}`} className="underline underline-offset-4">
            {t("backToProject")}
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
        <h2 className="text-lg font-semibold">{t("members", { count: sharing.members.length })}</h2>
        {sharing.members.length === 0 ? (
          <p className="opacity-70">{t("membersEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sharing.members.map((member) => (
              <li
                key={member.userId}
                data-testid="member"
                className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
              >
                <p>
                  <span className="font-medium">{member.email ?? t("unknownMember")}</span>
                  <span className="opacity-80">
                    {t("separator")}
                    {t(`roles.${member.role}`)}
                    {t("separator")}
                    {t("since", { date: day(member.joinedAt) })}
                  </span>
                </p>
                <AuthForm action={removeMember} submitLabel={t("remove")} pendingLabel={t("pending")} destructive>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="userId" value={member.userId} />
                </AuthForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("invitations", { count: sharing.invitations.length })}</h2>
        {sharing.invitations.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {sharing.invitations.map((invitation) => (
              <li
                key={invitation.id}
                data-testid="invitation"
                className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
              >
                <p>
                  <span className="font-medium">{invitation.email}</span>
                  <span className="opacity-80">
                    {t("separator")}
                    {t(`roles.${invitation.role}`)}
                    {t("separator")}
                    {t("expires", { date: day(invitation.expiresAt) })}
                  </span>
                </p>
                <AuthForm action={revokeInvitation} submitLabel={t("revoke")} pendingLabel={t("pending")}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="invitationId" value={invitation.id} />
                </AuthForm>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("inviteHeading")}</h2>
        <p className="text-sm opacity-80">{t("inviteIntro")}</p>
        <AuthForm action={inviteMember} submitLabel={t("invite")} pendingLabel={t("pending")}>
          <input type="hidden" name="projectId" value={project.id} />
          <OptionalTextField name="email" label={t("fields.email")} hint={t("fields.emailHint")} maxLength={254} required />
          <SelectField
            name="role"
            label={t("fields.role")}
            placeholder={t("choose")}
            options={MEMBER_ROLES.map((role) => ({ value: role, label: t(`roleChoices.${role}`) }))}
            defaultValue="supervisor"
            required
          />
        </AuthForm>
      </section>
    </AuthPageShell>
  );
}
