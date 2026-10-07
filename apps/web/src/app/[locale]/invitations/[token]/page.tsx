import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requireOnboardedUser } from "@/lib/profile/guard";
import { acceptInvitation } from "@/lib/projects/sharing-actions";
import { getInvitationPreview, INVITATION_TOKEN } from "@/lib/projects/sharing-queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Sharing");
  // Le jeton est dans l'adresse : la page ne s'indexe pas et ne transmet pas son adresse.
  return { title: t("invitationTitle"), robots: { index: false }, referrer: "no-referrer" };
}

/**
 * Invitation à suivre un projet. Le lien seul ne donne rien : il faut être
 * connecté sous l'adresse invitée, puis accepter.
 */
export default async function InvitationPage({ params }: PageProps<"/[locale]/invitations/[token]">) {
  const { token } = await params;
  const valid = INVITATION_TOKEN.test(token);
  const { user } = await requireOnboardedUser(valid ? `/invitations/${token}` : "/shared");

  const [t, preview] = await Promise.all([
    getTranslations("Sharing"),
    valid ? getInvitationPreview(token) : null,
  ]);

  return (
    <AuthPageShell
      title={t("invitationTitle")}
      footer={
        <p>
          <Link href="/shared" className="underline underline-offset-4">
            {t("toShared")}
          </Link>
        </p>
      }
    >
      {preview ? (
        <>
          <p data-testid="invitation-preview">
            {t("invitationIntro", {
              owner: preview.ownerEmail ?? t("unknownMember"),
              project: preview.projectTitle,
              role: t(`roles.${preview.role}`),
            })}
          </p>
          <p className="text-sm opacity-80">{t(`roleHelp.${preview.role}`)}</p>
          <AuthForm action={acceptInvitation} submitLabel={t("accept")} pendingLabel={t("pending")}>
            <input type="hidden" name="token" value={token} />
          </AuthForm>
        </>
      ) : (
        // Lien inconnu, expiré, révoqué, déjà utilisé ou destiné à une autre adresse : même message.
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("invitationInvalid", { email: user.email ?? "" })}
        </p>
      )}
    </AuthPageShell>
  );
}
