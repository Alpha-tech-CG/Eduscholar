"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState } from "react";
import { findUser, type LookupState } from "@/lib/admin/actions";
import { AccountActions } from "./account-actions";

const initial: LookupState = { status: "idle" };

/** Recherche d'un compte par son adresse exacte, et actions sur le compte trouvé. */
export function UserLookup({ adminRank }: { adminRank: number }) {
  const t = useTranslations("Admin");
  const tErrors = useTranslations("Auth.errors");
  const format = useFormatter();
  const [state, search, pending] = useActionState(findUser, initial);

  return (
    <div className="flex flex-col gap-4">
      <form action={search} className="flex flex-col gap-3">
        {state.status === "error" ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {tErrors(state.error)}
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="lookup-email" className="font-medium">
            {t("lookupEmail")}
          </label>
          <input
            id="lookup-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            maxLength={320}
            defaultValue={state.status === "error" ? state.email : ""}
            className="rounded border border-foreground/30 bg-background px-3 py-2"
          />
          <p className="text-sm opacity-70">{t("lookupHint")}</p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
        >
          {pending ? t("pending") : t("lookup")}
        </button>
      </form>

      {state.status === "found" ? (
        <div data-testid="found-user" className="flex flex-col gap-4 rounded border border-foreground/20 p-3">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <dt className="text-sm opacity-70">{t("email")}</dt>
            <dd className="break-all">{state.user.email}</dd>
            <dt className="text-sm opacity-70">{t("createdAt")}</dt>
            <dd>{format.dateTime(new Date(state.user.createdAt), { dateStyle: "long" })}</dd>
            <dt className="text-sm opacity-70">{t("state")}</dt>
            <dd>
              {[
                state.user.confirmed ? t("confirmed") : t("unconfirmed"),
                state.user.hasSecondFactor ? t("secondFactorOn") : t("secondFactorOff"),
                state.user.suspended ? t("suspendedState") : t("activeState"),
              ].join(t("separator"))}
            </dd>
            <dt className="text-sm opacity-70">{t("rolesLabel")}</dt>
            <dd>
              {state.user.roles.length > 0
                ? state.user.roles.map((role) => t(`roles.${role as "moderator"}`)).join(t("separator"))
                : t("noRole")}
            </dd>
            {state.user.suspensionReason ? (
              <>
                <dt className="text-sm opacity-70">{t("reason")}</dt>
                <dd className="whitespace-pre-line">{state.user.suspensionReason}</dd>
              </>
            ) : null}
          </dl>
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">{t("history.heading")}</h3>
            {state.user.history === null ? (
              <p role="alert">{t("loadFailed")}</p>
            ) : state.user.history.length === 0 ? (
              <p className="text-sm opacity-70">{t("history.empty")}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {state.user.history.map((change, index) => (
                  <li key={index} data-testid="status-change" className="rounded border border-foreground/20 p-2 text-sm">
                    <p>
                      {[
                        format.dateTime(new Date(change.changedAt), { dateStyle: "long", timeStyle: "short" }),
                        change.suspended ? t("history.suspended") : t("history.restored"),
                        change.by ?? t("history.byDeleted"),
                      ].join(t("separator"))}
                    </p>
                    {change.reason ? <p className="whitespace-pre-line">{change.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <AccountActions
            userId={state.user.userId}
            roles={state.user.roles}
            suspended={state.user.suspended}
            adminRank={adminRank}
          />
        </div>
      ) : null}
    </div>
  );
}
