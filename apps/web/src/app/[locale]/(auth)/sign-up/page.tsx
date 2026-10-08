import { Captcha } from "@/components/auth/captcha";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm, CheckboxField, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { signUp } from "@/lib/auth/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.signUp");
  return { title: t("title"), robots: { index: false } };
}

export default async function SignUpPage() {
  const t = await getTranslations("Auth");

  return (
    <AuthPageShell
      title={t("signUp.title")}
      intro={t("signUp.intro")}
      footer={
        <p className="flex flex-wrap gap-x-1">
          <span>{t("signUp.haveAccount")}</span>
          <Link href="/sign-in" className="underline underline-offset-4">
            {t("signIn.title")}
          </Link>
        </p>
      }
    >
      <AuthForm
        action={signUp}
        submitLabel={t("signUp.submit")}
        pendingLabel={t("pending")}
      >
        <TextField name="email" type="email" autoComplete="email" label={t("fields.email")} />
        <TextField
          name="password"
          type="password"
          autoComplete="new-password"
          label={t("fields.password")}
          hint={t("fields.passwordHint")}
        />
        <TextField
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          label={t("fields.passwordConfirmation")}
        />
        <CheckboxField name="ageConfirmed" label={t("fields.ageConfirmed")} />
        <Captcha />
      </AuthForm>
    </AuthPageShell>
  );
}
