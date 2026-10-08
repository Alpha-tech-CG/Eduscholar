import { Captcha } from "@/components/auth/captcha";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthForm, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link, redirect } from "@/i18n/navigation";
import { signIn } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/session";
import { parseSignInNotice } from "@/lib/auth/state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.signIn");
  return { title: t("title"), robots: { index: false } };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/[locale]/sign-in">) {
  const params = await searchParams;
  const nextPath = safeNextPath(first(params.next));
  // Le message affiché vient d'une liste fermée, jamais du texte de l'adresse.
  const notice = parseSignInNotice(first(params.notice));

  if (await getCurrentUser()) {
    redirect({ href: nextPath, locale: await getLocale() });
  }

  const t = await getTranslations("Auth");

  return (
    <AuthPageShell
      title={t("signIn.title")}
      footer={
        <>
          <p>
            <Link href="/forgot-password" className="underline underline-offset-4">
              {t("signIn.forgot")}
            </Link>
          </p>
          <p className="flex flex-wrap gap-x-1">
            <span>{t("signIn.noAccount")}</span>
            <Link href="/sign-up" className="underline underline-offset-4">
              {t("signUp.title")}
            </Link>
          </p>
        </>
      }
    >
      {notice ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {notice === "email-confirmed"
            ? t("signIn.emailConfirmed")
            : notice === "password-updated"
              ? t("signIn.passwordUpdated")
              : notice === "code-refused"
                ? t("signIn.codeRefused")
                : t("signIn.accountDeleted")}
        </p>
      ) : null}
      <AuthForm
        action={signIn}
        submitLabel={t("signIn.submit")}
        pendingLabel={t("pending")}
      >
        {/* La destination est revalidée par le serveur à la soumission. */}
        <input type="hidden" name="next" value={nextPath} />
        <TextField name="email" type="email" autoComplete="email" label={t("fields.email")} />
        <TextField
          name="password"
          type="password"
          autoComplete="current-password"
          label={t("fields.password")}
        />
        <Captcha />
      </AuthForm>
    </AuthPageShell>
  );
}
