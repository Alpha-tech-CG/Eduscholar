import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthForm, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { redirect } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSecondFactorState, needsSecondFactor } from "@/lib/auth/second-factor";
import { verifySecondFactor } from "@/lib/auth/second-factor-actions";
import { getCurrentUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.secondFactor");
  return { title: t("verifyTitle"), robots: { index: false } };
}

export default async function VerifySecondFactorPage({
  searchParams,
}: PageProps<"/[locale]/sign-in/verify">) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  const locale = await getLocale();

  const user = await getCurrentUser();
  if (!user) {
    return redirect({ href: { pathname: "/sign-in", query: { next: nextPath } }, locale });
  }
  if (!needsSecondFactor(await getSecondFactorState())) {
    return redirect({ href: nextPath, locale });
  }

  const t = await getTranslations("Auth");

  return (
    <AuthPageShell
      title={t("secondFactor.verifyTitle")}
      intro={t("secondFactor.verifyIntro")}
      footer={
        <form action={signOut}>
          <button type="submit" className="underline underline-offset-4">
            {t("secondFactor.signOut")}
          </button>
        </form>
      }
    >
      <dl className="flex flex-col gap-1">
        <dt className="text-sm opacity-70">{t("resetPassword.account")}</dt>
        <dd className="font-medium">{user.email}</dd>
      </dl>
      <AuthForm
        action={verifySecondFactor}
        submitLabel={t("secondFactor.verifySubmit")}
        pendingLabel={t("pending")}
      >
        <input type="hidden" name="next" value={nextPath} />
        <TextField
          name="code"
          type="code"
          autoComplete="one-time-code"
          label={t("secondFactor.codeLabel")}
          hint={t("secondFactor.codeHint")}
        />
      </AuthForm>
    </AuthPageShell>
  );
}
