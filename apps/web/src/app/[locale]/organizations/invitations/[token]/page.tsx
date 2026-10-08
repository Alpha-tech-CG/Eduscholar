import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { acceptOrgInvitation } from "@/lib/organizations/actions";
import { getOrgInvitationPreview } from "@/lib/organizations/queries";
import { ORG_INVITATION_TOKEN } from "@/lib/organizations/schemas";
import { requireOnboardedUser } from "@/lib/profile/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Organizations.invitation");
  // Le jeton est dans l'adresse : la page ne s'indexe pas et ne transmet pas son adresse.
  return { title: t("title"), robots: { index: false }, referrer: "no-referrer" };
}

/**
 * Invitation à rejoindre une organisation. Le lien seul ne donne rien : il
 * faut être connecté sous l'adresse invitée, puis accepter.
 */
export default async function OrganizationInvitationPage({
  params,
}: PageProps<"/[locale]/organizations/invitations/[token]">) {
  const { token } = await params;
  const valid = ORG_INVITATION_TOKEN.test(token);
  const { user } = await requireOnboardedUser(valid ? `/organizations/invitations/${token}` : "/organizations");

  const [t, tRoles, preview] = await Promise.all([
    getTranslations("Organizations.invitation"),
    getTranslations("Organizations.roles"),
    valid ? getOrgInvitationPreview(token) : null,
  ]);

  return (
    <AuthPageShell
      title={t("title")}
      footer={
        <p>
          <Link href="/organizations" className="underline underline-offset-4">
            {t("toMine")}
          </Link>
        </p>
      }
    >
      {preview ? (
        <>
          <p data-testid="org-invitation-preview">
            {t("intro", { organization: preview.organizationName, role: tRoles(preview.role) })}
          </p>
          <p className="text-sm opacity-80">{t(`roleHelp.${preview.role}`)}</p>
          {preview.requiresSecondFactor ? (
            // La base refuserait l'acceptation : autant le dire avant, avec le chemin.
            <p data-testid="second-factor-needed" className="rounded border-2 border-foreground/60 p-3">
              {t("secondFactorNeeded")}{" "}
              <Link href="/account/security" className="underline underline-offset-4">
                {t("toSecurity")}
              </Link>
            </p>
          ) : (
            <>
              {preview.role === "org_admin" ? (
                <p className="text-sm opacity-80">{t("secondFactorNote")}</p>
              ) : null}
              <AuthForm action={acceptOrgInvitation} submitLabel={t("accept")} pendingLabel={t("pending")}>
                <input type="hidden" name="token" value={token} />
              </AuthForm>
            </>
          )}
        </>
      ) : (
        // Lien inconnu, expiré, révoqué, déjà utilisé ou destiné à une autre adresse : même message.
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("invalid", { email: user.email ?? "" })}
        </p>
      )}
    </AuthPageShell>
  );
}
