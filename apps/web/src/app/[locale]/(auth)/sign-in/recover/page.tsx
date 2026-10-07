import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link, redirect } from "@/i18n/navigation";
import { redeemRecoveryCode } from "@/lib/auth/recovery-codes-actions";
import { getSecondFactorState, needsSecondFactor } from "@/lib/auth/second-factor";
import { getCurrentUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.recoveryCodes");
  return { title: t("recoverTitle"), robots: { index: false } };
}

/**
 * Connexion sans l'application d'authentification, par un code de secours. La
 * page ne sert qu'à qui s'est connecté par mot de passe et à qui un code de
 * validation est demandé.
 */
export default async function RecoverSecondFactorPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/sign-in", locale });
  if (!needsSecondFactor(await getSecondFactorState())) {
    return redirect({ href: "/account/security", locale });
  }

  const t = await getTranslations("Auth");

  return (
    <AuthPageShell
      title={t("recoveryCodes.recoverTitle")}
      intro={t("recoveryCodes.recoverIntro")}
      footer={
        <p>
          <Link href="/sign-in/verify" className="underline underline-offset-4">
            {t("recoveryCodes.backToCode")}
          </Link>
        </p>
      }
    >
      <dl className="flex flex-col gap-1">
        <dt className="text-sm opacity-70">{t("resetPassword.account")}</dt>
        <dd className="font-medium">{user.email}</dd>
      </dl>
      <ul className="list-disc ps-5 text-sm opacity-80">
        <li>{t("recoveryCodes.recoverEffect")}</li>
        <li>{t("recoveryCodes.recoverRoles")}</li>
      </ul>
      <AuthForm
        action={redeemRecoveryCode}
        submitLabel={t("recoveryCodes.recoverSubmit")}
        pendingLabel={t("pending")}
      >
        <OptionalTextField
          name="recoveryCode"
          label={t("recoveryCodes.recoveryCode")}
          hint={t("recoveryCodes.recoveryCodeHint")}
          maxLength={40}
          required
        />
      </AuthForm>
    </AuthPageShell>
  );
}
