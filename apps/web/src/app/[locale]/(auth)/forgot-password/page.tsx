import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { requestPasswordReset } from "@/lib/auth/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.forgotPassword");
  return { title: t("title"), robots: { index: false } };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("Auth");

  return (
    <AuthPageShell
      title={t("forgotPassword.title")}
      intro={t("forgotPassword.intro")}
      footer={
        <p>
          <Link href="/sign-in" className="underline underline-offset-4">
            {t("forgotPassword.back")}
          </Link>
        </p>
      }
    >
      <AuthForm
        action={requestPasswordReset}
        submitLabel={t("forgotPassword.submit")}
        pendingLabel={t("pending")}
      >
        <TextField name="email" type="email" autoComplete="email" label={t("fields.email")} />
      </AuthForm>
    </AuthPageShell>
  );
}
