"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { Link } from "@/i18n/navigation";
import { importReferences, type ImportRejection, type ImportState } from "@/lib/projects/import-actions";

const initial: ImportState = { status: "idle" };

const button =
  "self-start rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60";

function Rejections({ rejected }: { rejected: ImportRejection[] }) {
  const t = useTranslations("Projects.import");
  if (rejected.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">{t("rejectedHeading", { count: rejected.length })}</h3>
      <ul data-testid="import-rejected" className="flex flex-col gap-1 text-sm">
        {rejected.map((entry) => (
          <li key={`${entry.index}-${entry.code}`}>
            {entry.label
              ? t("rejectedEntryWithLabel", {
                  number: entry.index + 1,
                  label: entry.label,
                  reason: t(`reasons.${entry.code}`),
                })
              : t("rejectedEntry", { number: entry.index + 1, reason: t(`reasons.${entry.code}`) })}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Import de références BibTeX ou RIS : aperçu, puis import dans les sources du projet. */
export function ReferenceImportForm({ projectId }: { projectId: string }) {
  const t = useTranslations("Projects.import");
  const tType = useTranslations("Projects.sources.type");
  const [state, action, pending] = useActionState(importReferences, initial);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle") feedback.current?.focus();
  }, [state]);

  if (state.status === "done") {
    return (
      <div ref={feedback} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        <p role="status" data-testid="import-done" className="rounded border border-foreground/20 p-3">
          {t("done", { count: state.created })}
        </p>
        <Rejections rejected={state.rejected} />
        <p className="flex flex-wrap gap-4">
          <Link href={`/projects/${projectId}/sources`} className="underline underline-offset-4">
            {t("toSources")}
          </Link>
          <Link href={`/projects/${projectId}/bibliography`} className="underline underline-offset-4">
            {t("toBibliography")}
          </Link>
        </p>
      </div>
    );
  }

  if (state.status === "preview") {
    return (
      <div ref={feedback} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        <p role="status" className="rounded border border-foreground/20 p-3">
          {t("previewSummary", {
            format: state.format === "bibtex" ? "BibTeX" : "RIS",
            accepted: state.entries.length,
            rejected: state.rejected.length,
          })}
        </p>
        {state.entries.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">{t("acceptedHeading", { count: state.entries.length })}</h3>
            <ol data-testid="import-preview" className="flex flex-col gap-2 text-sm">
              {state.entries.map((entry) => (
                <li key={entry.index} className="rounded border border-foreground/20 p-2">
                  <p className="font-medium">{entry.title}</p>
                  <p className="opacity-80">
                    {[tType(entry.sourceType as "other"), entry.authors, entry.year].filter(Boolean).join(" · ")}
                  </p>
                  {entry.dropped.length > 0 ? (
                    <p className="opacity-80">
                      {t("dropped", { fields: entry.dropped.map((field) => t(`fields.${field}`)).join(", ") })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <Rejections rejected={state.rejected} />
        <p className="text-sm opacity-80">{t("verifyNotice")}</p>
        {state.entries.length > 0 ? (
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="intent" value="import" />
            <input type="hidden" name="content" value={state.content} />
            <button type="submit" disabled={pending} className={button}>
              {pending ? t("pending") : t("confirm", { count: state.entries.length })}
            </button>
          </form>
        ) : null}
        <p>
          <Link href={`/projects/${projectId}/sources/import`} className="underline underline-offset-4">
            {t("restart")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div ref={feedback} tabIndex={-1} aria-live="assertive" className="outline-none">
        {state.status === "error" ? (
          <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
      </div>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="intent" value="preview" />
      <div className="flex flex-col gap-1">
        <label htmlFor="import-file" className="font-medium">
          {t("file")}
        </label>
        <input
          id="import-file"
          name="file"
          type="file"
          accept=".bib,.bibtex,.ris,.txt,text/plain,application/x-bibtex,application/x-research-info-systems"
          aria-describedby="import-file-hint"
          className="rounded border border-foreground/30 bg-background px-3 py-2"
        />
        <p id="import-file-hint" className="text-sm opacity-70">
          {t("fileHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="import-content" className="font-medium">
          {t("paste")}
        </label>
        <textarea
          id="import-content"
          name="content"
          rows={6}
          className="rounded border border-foreground/30 bg-background px-3 py-2 font-mono text-sm"
        />
      </div>
      <button type="submit" disabled={pending} className={button}>
        {pending ? t("pending") : t("preview")}
      </button>
    </form>
  );
}
