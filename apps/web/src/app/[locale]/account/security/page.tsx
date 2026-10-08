import { Captcha } from "@/components/auth/captcha";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm, TextField } from "@/components/auth/form";
import { AuthPageShell } from "@/components/auth/page-shell";
import { RecoveryCodes } from "@/components/auth/recovery-codes";
import { SecondFactorEnrollment } from "@/components/auth/second-factor-enrollment";
import { Link } from "@/i18n/navigation";
import { getLastRecoveryCodeUse, getRecoveryCodesState } from "@/lib/auth/recovery-codes";
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
  const [{ enabled, sessionVerified }, t, { notice }] = await Promise.all([
    getSecondFactorState(),
    getTranslations("Auth"),
    searchParams,
  ]);
  const recovery = enabled && sessionVerified ? await getRecoveryCodesState() : null;
  // Lisible seulement quand le compte est actif : sinon, rien n'est rendu.
  const [format, lastRecoveryUse] = await Promise.all([getFormatter(), getLastRecoveryCodeUse()]);

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
      {notice === "enabled" || notice === "disabled" || notice === "recovered" ? (
        <p role="status" className="rounded border border-foreground/20 p-3">
          {notice === "enabled"
            ? t("secondFactor.enabledNotice")
            : notice === "recovered"
              ? t("recoveryCodes.recoveredNotice")
              : t("secondFactor.disabledNotice")}
        </p>
      ) : null}

      {lastRecoveryUse ? (
        <p data-testid="recovery-use-warning" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {t("recoveryCodes.useWarning", {
            date: format.dateTime(new Date(lastRecoveryUse), { dateStyle: "long", timeStyle: "short" }),
          })}
        </p>
      ) : null}

      <p data-testid="second-factor-state" className="font-medium">
        {enabled ? t("secondFactor.stateEnabled") : t("secondFactor.stateDisabled")}
      </p>

      {recovery ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("recoveryCodes.heading")}</h2>
          <p className="text-sm opacity-80">{t("recoveryCodes.intro")}</p>
          <RecoveryCodes
            captcha={<Captcha />}
            remaining={recovery.remaining}
            generatedOn={
              recovery.generatedAt
                ? format.dateTime(new Date(recovery.generatedAt), { dateStyle: "long" })
                : null
            }
            recentSecondFactor={recovery.recentSecondFactor}
          />
        </section>
      ) : null}

      {enabled ? (
        <>
          <h2 className="text-lg font-semibold">{t("secondFactor.disableHeading")}</h2>
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
          <SecondFactorEnrollment captcha={<Captcha />} />
        </>
      )}
    </AuthPageShell>
  );
}
