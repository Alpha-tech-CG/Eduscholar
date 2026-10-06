import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthForm, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { redirect } from "@/i18n/navigation";
import { updatePassword } from "@/lib/auth/actions";
import { getSecondFactorState, needsSecondFactor } from "@/lib/auth/second-factor";
import { getCurrentUser, isRecentRecoverySession } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.resetPassword");
  return { title: t("title"), robots: { index: false } };
}

export default async function ResetPasswordPage() {
  // Accessible uniquement avec la session ouverte, il y a peu, par le lien de
  // réinitialisation. L'action refait ce contrôle : la page n'est pas une barrière.
  const user = await getCurrentUser();
  if (!user || !(await isRecentRecoverySession())) {
    return redirect({ href: "/forgot-password", locale: await getLocale() });
  }
  // Un compte à deux étapes saisit d'abord son code : le service
  // d'authentification refuse sinon tout changement de mot de passe.
  if (needsSecondFactor(await getSecondFactorState())) {
    return redirect({
      href: { pathname: "/sign-in/verify", query: { next: "/reset-password" } },
      locale: await getLocale(),
    });
  }

  const t = await getTranslations("Auth");

  return (
    <AuthPageShell title={t("resetPassword.title")} intro={t("resetPassword.intro")}>
      {/* L'adresse du compte est affichée : si le lien venait d'un tiers, la
          personne voit que ce n'est pas son compte. */}
      <dl className="flex flex-col gap-1">
        <dt className="text-sm opacity-70">{t("resetPassword.account")}</dt>
        <dd data-testid="reset-account-email" className="font-medium">
          {user.email}
        </dd>
      </dl>
      <AuthForm
        action={updatePassword}
        submitLabel={t("resetPassword.submit")}
        pendingLabel={t("pending")}
      >
        <TextField
          name="password"
          type="password"
          autoComplete="new-password"
          label={t("fields.newPassword")}
          hint={t("fields.passwordHint")}
        />
        <TextField
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          label={t("fields.passwordConfirmation")}
        />
      </AuthForm>
    </AuthPageShell>
  );
}
