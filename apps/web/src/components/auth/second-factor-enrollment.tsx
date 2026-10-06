"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  confirmSecondFactorEnrollment,
  startSecondFactorEnrollment,
  type EnrollmentState,
} from "@/lib/auth/second-factor-actions";
import { AuthForm, TextField } from "./form";

const initial: EnrollmentState = { status: "idle" };

/**
 * Activation du second facteur en deux temps : obtenir le secret, puis prouver
 * par un premier code que l'application d'authentification est configurée.
 */
export function SecondFactorEnrollment() {
  const t = useTranslations("Auth.secondFactor");
  const [state, start, pending] = useActionState(startSecondFactorEnrollment, initial);

  if (state.status !== "enrolling") {
    return (
      <form action={start} className="flex flex-col gap-3">
        {state.status === "error" ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {t(`enrollErrors.${state.error}`)}
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="enroll-password" className="font-medium">
            {t("passwordLabel")}
          </label>
          <input
            id="enroll-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border border-foreground/30 bg-background px-3 py-2"
          />
          <p className="text-sm opacity-70">{t("passwordHint")}</p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
        >
          {pending ? t("pending") : t("enable")}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-3 ps-5">
        <li>{t("stepScan")}</li>
        <li>{t("stepCode")}</li>
      </ol>
      {/* Le QR code est une image SVG générée par le service d'authentification,
          fournie sous forme d'adresse de données : rien n'est chargé d'ailleurs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={state.qrCode}
        alt={t("qrAlt")}
        width={192}
        height={192}
        className="self-start rounded bg-white p-2"
      />
      <dl className="flex flex-col gap-1">
        <dt className="text-sm opacity-70">{t("secretLabel")}</dt>
        <dd data-testid="second-factor-secret" className="break-all font-mono">
          {state.secret}
        </dd>
      </dl>
      <AuthForm
        action={confirmSecondFactorEnrollment}
        submitLabel={t("confirm")}
        pendingLabel={t("pending")}
      >
        <TextField
          name="code"
          type="code"
          autoComplete="one-time-code"
          label={t("codeLabel")}
          hint={t("codeHint")}
        />
      </AuthForm>
    </div>
  );
}
