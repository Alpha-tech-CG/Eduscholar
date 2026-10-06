import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthForm, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { SecondFactorEnrollment } from "@/components/auth/second-factor-enrollment";
import { Link } from "@/i18n/navigation";
import { getSecondFactorState } from "@/lib/auth/second-factor";
import { disableSecondFactor } from "@/lib/auth/second-factor-actions";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.secondFactor");
  return { title: t("title"), robots: { index: false } };
}

export default async function SecurityPage({
  searchParams,
}: PageProps<"/[locale]/account/security">) {
  await requireUser("/account/security");
  const [{ enabled }, t, { notice }] = await Promise.all([
    getSecondFactorState(),
    getTranslations("Auth"),
    searchParams,
  ]);

  return (
    <AuthPageShell
      title={t("secondFactor.title")}
      intro={t("secondFactor.intro")}
      footer={
        <p>
          <Link href="/account" className="underline underline-offset-4">
            {t("secondFactor.back")}
          </Link>
        </p>
      }
    >
      {notice === "enabled" || notice === "disabled" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {notice === "enabled"
            ? t("secondFactor.enabledNotice")
            : t("secondFactor.disabledNotice")}
        </p>
      ) : null}

      <p data-testid="second-factor-state" className="font-medium">
        {enabled ? t("secondFactor.stateEnabled") : t("secondFactor.stateDisabled")}
      </p>

      {enabled ? (
        <>
          <p className="text-sm opacity-80">{t("secondFactor.disableIntro")}</p>
          <AuthForm
            action={disableSecondFactor}
            submitLabel={t("secondFactor.disable")}
            pendingLabel={t("pending")}
            destructive
          >
            <TextField
              name="code"
              type="code"
              autoComplete="one-time-code"
              label={t("secondFactor.codeLabel")}
              hint={t("secondFactor.codeHint")}
            />
          </AuthForm>
        </>
      ) : (
        <>
          <p className="text-sm opacity-80">{t("secondFactor.lossWarning")}</p>
          <SecondFactorEnrollment />
        </>
      )}
    </AuthPageShell>
  );
}
