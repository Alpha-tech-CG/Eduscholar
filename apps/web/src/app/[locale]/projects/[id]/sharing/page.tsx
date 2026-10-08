import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuthForm, CheckboxGroup, OptionalTextField, SelectField } from "@/components/auth/form";
import { ShareLinkForm } from "@/components/projects/share-link-form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { getProject } from "@/lib/projects/queries";
import { getSections } from "@/lib/projects/section-queries";
import {
  decideAccessRequest,
  inviteMember,
  removeMember,
  revokeInvitation,
  revokeShareLink,
  setMemberScope,
} from "@/lib/projects/sharing-actions";
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
  "scope-changed": "noticeScopeChanged",
  "link-revoked": "noticeLinkRevoked",
  "request-approved": "noticeRequestApproved",
  "request-refused": "noticeRequestRefused",
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

  const [t, tAuth, format, sections, { notice }] = await Promise.all([
    getTranslations("Sharing"),
    getTranslations("Auth"),
    getFormatter(),
    getSections(project.id),
    searchParams,
  ]);
  const sectionOptions = (sections ?? []).map((section) => ({ value: section.id, label: section.title }));
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
                    {t("separator")}
                    {member.fullAccess ? t("scope.full") : t("scope.limited", { count: member.sectionIds.length })}
                  </span>
                </p>
                {sectionOptions.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer underline underline-offset-4">{t("scope.change")}</summary>
                    <div className="mt-3">
                      <AuthForm action={setMemberScope} submitLabel={t("scope.save")} pendingLabel={t("pending")}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <SelectField
                          name="access"
                          label={t("scope.access")}
                          placeholder={t("choose")}
                          options={[
                            { value: "full", label: t("scope.fullChoice") },
                            { value: "limited", label: t("scope.limitedChoice") },
                          ]}
                          defaultValue={member.fullAccess ? "full" : "limited"}
                          required
                        />
                        <CheckboxGroup
                          name="sections"
                          legend={t("scope.sections")}
                          options={sectionOptions}
                          defaultValues={member.sectionIds}
                        />
                      </AuthForm>
                    </div>
                  </details>
                ) : null}
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
                    {invitation.fullAccess ? "" : `${t("separator")}${t("scope.limitedInvitation")}`}
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
          {sectionOptions.length > 0 ? (
            <CheckboxGroup
              name="sections"
              legend={t("scope.inviteSections")}
              options={sectionOptions}
              defaultValues={[]}
            />
          ) : null}
        </AuthForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("requests.heading", { count: sharing.requests.length })}</h2>
        {sharing.requests.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {sharing.requests.map((request) => (
              <li
                key={request.id}
                data-testid="access-request"
                className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
              >
                <p>
                  <span className="font-medium">{request.email ?? t("unknownMember")}</span>
                  <span className="opacity-80">
                    {request.displayName ? `${t("separator")}${request.displayName}` : ""}
                    {t("separator")}
                    {t(`roles.${request.role}`)}
                    {t("separator")}
                    {t("requests.askedOn", { date: day(request.createdAt) })}
                  </span>
                </p>
                <div className="flex flex-wrap gap-4">
                  <AuthForm action={decideAccessRequest} submitLabel={t("requests.approve")} pendingLabel={t("pending")}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="approve" value="true" />
                  </AuthForm>
                  <AuthForm
                    action={decideAccessRequest}
                    submitLabel={t("requests.refuse")}
                    pendingLabel={t("pending")}
                    destructive
                  >
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="approve" value="false" />
                  </AuthForm>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("link.heading")}</h2>
        <p className="text-sm opacity-80">{t("link.intro")}</p>
        {sharing.link ? (
          <div className="flex flex-col gap-2" data-testid="active-link">
            <p>
              {t("link.active", { role: t(`roles.${sharing.link.role}`), date: day(sharing.link.expiresAt) })}
            </p>
            <AuthForm action={revokeShareLink} submitLabel={t("link.revoke")} pendingLabel={t("pending")} destructive>
              <input type="hidden" name="projectId" value={project.id} />
            </AuthForm>
          </div>
        ) : null}
        <ShareLinkForm
          projectId={project.id}
          hasLink={sharing.link !== null}
          labels={{
            role: t("link.role"),
            roles: MEMBER_ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) })),
            create: t("link.create"),
            replace: t("link.replace"),
            pending: t("pending"),
            created: t("link.created"),
            linkLabel: t("link.linkLabel"),
            keepSafe: t("link.keepSafe"),
            errors: {
              session_expired: tAuth("errors.session_expired"),
              validation: tAuth("errors.validation"),
              rate_limited: tAuth("errors.rate_limited"),
              not_found: tAuth("errors.not_found"),
              forbidden: tAuth("errors.forbidden"),
            },
            fallbackError: tAuth("errors.unavailable"),
          }}
        />
      </section>
    </AuthPageShell>
  );
}
