"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  generateRecoveryCodes,
  type RecoveryCodesFormState,
} from "@/lib/auth/recovery-codes-actions";

const initial: RecoveryCodesFormState = { status: "idle" };

type RecoveryCodesProps = {
  remaining: number;
  /** Date de génération des codes en cours, déjà mise en forme. */
  generatedOn: string | null;
  /** Faux : un code de l'application d'authentification est demandé avant de générer. */
  recentSecondFactor: boolean;
  /** Défi anti-robot, rendu par le serveur : le mot de passe est revérifié auprès du service. */
  captcha?: ReactNode;
};

/** Génération des codes de secours. Ils ne sont affichés qu'une fois. */
export function RecoveryCodes({
  remaining,
  generatedOn,
  recentSecondFactor,
  captcha,
}: RecoveryCodesProps) {
  const t = useTranslations("Auth.recoveryCodes");
  const tErrors = useTranslations("Auth.errors");
  const [state, generate, pending] = useActionState(generateRecoveryCodes, initial);

  if (state.status === "generated") {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("generated")}
        </p>
        <ul data-testid="recovery-codes" className="grid gap-2 font-mono sm:grid-cols-2">
          {state.codes.map((code) => (
            <li key={code} className="rounded border border-foreground/20 px-3 py-2">
              {code}
            </li>
          ))}
        </ul>
        <p className="text-sm opacity-80">{t("keepSafe")}</p>
      </div>
    );
  }

  const askCode =
    !recentSecondFactor ||
    (state.status === "error" && state.error === "recent_second_factor_required");

  return (
    <form action={generate} className="flex flex-col gap-3">
      <p data-testid="recovery-codes-remaining" className="text-sm">
        {t("remaining", { count: remaining })}
        {remaining > 0 && generatedOn ? <span> {t("generatedOn", { date: generatedOn })}</span> : null}
      </p>
      {state.status === "error" ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {tErrors(state.error)}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="recovery-codes-password" className="font-medium">
          {t("passwordLabel")}
        </label>
        <input
          id="recovery-codes-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-foreground/30 bg-background px-3 py-2"
        />
        <p className="text-sm opacity-70">{t("passwordHint")}</p>
      </div>
      {askCode ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="recovery-codes-totp" className="font-medium">
            {t("codeLabel")}
          </label>
          <input
            id="recovery-codes-totp"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            required
            className="rounded border border-foreground/30 bg-background px-3 py-2"
          />
          <p className="text-sm opacity-70">{t("codeHint")}</p>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
      >
        {pending ? t("pending") : remaining > 0 ? t("regenerate") : t("generate")}
      </button>
      {remaining > 0 ? <p className="text-sm opacity-70">{t("regenerateHint")}</p> : null}
      {captcha}
    </form>
  );
}
