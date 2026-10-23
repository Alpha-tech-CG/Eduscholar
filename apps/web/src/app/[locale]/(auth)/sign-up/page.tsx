import { Captcha } from "@/components/auth/captcha";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { AuthForm, CheckboxField, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { Link } from "@/i18n/navigation";
import { signUp } from "@/lib/auth/actions";
import { signUpMode } from "@/lib/auth/signup-mode";
import { serverEnv } from "@/lib/env.server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.signUp");
  return { title: t("title"), robots: { index: false } };
}

/** Rend une balise du message (« <privacy>…</privacy> ») en lien vers une page juridique. */
function legalLink(href: string) {
  return function LegalLink(chunks: ReactNode) {
    return (
      <Link href={href} className="underline underline-offset-4">
        {chunks}
      </Link>
    );
  };
}

export default async function SignUpPage() {
  const t = await getTranslations("Auth");
  const mode = signUpMode(serverEnv().SIGNUP_MODE);
  const legal = t.rich("signUp.legalNotice", {
    privacy: legalLink("/legal/privacy"),
    content: legalLink("/legal/content"),
    minors: legalLink("/legal/minors"),
  });

  if (mode === "invite_only") {
    // Pilote restreint : l'inscription se fait sur invitation. C'est un
    // affichage ; c'est le service d'authentification qui refuse l'inscription.
    return (
      <AuthPageShell
        title={t("signUp.title")}
        footer={
          <p className="flex flex-wrap gap-x-1">
            <span>{t("signUp.haveAccount")}</span>
            <Link href="/sign-in" className="underline underline-offset-4">
              {t("signIn.title")}
            </Link>
          </p>
        }
      >
        <p data-testid="signup-invite-only" className="rounded border border-foreground/30 p-4">
          {t("signUp.inviteOnly")}
        </p>
        <p className="text-sm opacity-80">{legal}</p>
      </AuthPageShell>
    );
  }

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
        <p className="text-sm opacity-80" data-testid="signup-legal">
          {legal}
        </p>
        <Captcha />
      </AuthForm>
    </AuthPageShell>
  );
}
