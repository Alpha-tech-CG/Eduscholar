"use client";

import { useLocale } from "next-intl";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { initialAuthState } from "@/lib/auth/state";
import { retryDelay } from "@/lib/offline/retry";
import {
  loadSectionVersion,
  saveSectionDraft,
  updateSection,
  type SectionVersion,
} from "@/lib/projects/section-actions";
import { countWords, SECTION_BODY_MAX } from "@/lib/projects/section-text";

// Éditeur d'une section : enregistrement automatique, et sortie de conflit sans
// recharger la page. Sans script, le formulaire s'envoie comme avant.
//
// Rien de ce qui est saisi n'est jamais remplacé sans un geste de l'utilisateur,
// et la page ne se quitte pas avec un texte non enregistré sans qu'il le sache.
//
// Sans réseau (ADR-0012) : le texte reste dans la page, en mémoire seulement —
// jamais dans le stockage du navigateur —, l'état le dit, et l'envoi reprend au
// retour du réseau ou après un délai croissant. Fermer l'onglet avant perd ce
// qui n'a pas été envoyé : le navigateur demande confirmation.

/** Attente après la dernière frappe, et intervalle minimal entre deux envois. */
const IDLE_MS = 2500;
const MIN_INTERVAL_MS = 10_000;
/** Attente minimale après un refus pour débit : le serveur a demandé de ralentir. */
const RATE_LIMIT_MS = 30_000;

/** L'envoi n'a pas atteint le serveur : appareil hors ligne, ou serveur injoignable. */
type Network = "offline" | "unreachable" | null;

type Draft = { title: string; level: string; body: string };

const ERROR_CODES = [
  "validation",
  "rate_limited",
  "limit_reached",
  "session_expired",
  "not_found",
  "forbidden",
  "unavailable",
] as const;
type EditorError = (typeof ERROR_CODES)[number];

export type SectionEditorLabels = {
  title: string;
  level: string;
  choose: string;
  levels: { value: string; label: string }[];
  body: string;
  bodyHint: string;
  save: string;
  pending: string;
  /** « {count} » est remplacé par le nombre de mots. */
  words: { zero: string; one: string; other: string };
  status: {
    unsaved: string;
    saving: string;
    savedAt: string;
    retrying: string;
    /** L'envoi n'est pas parti : appareil hors ligne. */
    offline: string;
    /** L'envoi n'est pas arrivé alors que l'appareil se dit en ligne. */
    unreachable: string;
  };
  /** Ce que devient le texte tant que le réseau manque. */
  network: string;
  errors: Record<EditorError, string>;
  fieldErrors: { required: string; too_long: string; invalid_choice: string };
  /** Demande de confirmation avant de quitter la page avec un texte non enregistré. */
  leave: string;
  conflict: {
    heading: string;
    intro: string;
    theirTitle: string;
    theirLevel: string;
    theirs: string;
    keepMine: string;
    takeTheirs: string;
    gone: string;
    /** Sans script : la page doit être rechargée. */
    reload: string;
  };
};

type Props = {
  projectId: string;
  sectionId: string;
  /** Compte sous lequel la page a été chargée : le serveur n'enregistre pas pour un autre. */
  editorId: string;
  initial: Draft & { updatedAt: string };
  labels: SectionEditorLabels;
};

type Status =
  | { kind: "clean" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; error: EditorError; retrying: boolean };

const same = (a: Draft, b: Draft) => a.title === b.title && a.level === b.level && a.body === b.body;

/** Le texte tel que la base le range : sauts de ligne simples, sans espaces autour. */
const stored = (draft: Draft): Draft => ({
  title: draft.title.trim(),
  level: draft.level,
  body: draft.body.replace(/\r\n?/g, "\n").trim(),
});

const fieldClass =
  "rounded border border-foreground/30 bg-background px-3 py-2 aria-[invalid=true]:border-red-700";

export function SectionEditor({ projectId, sectionId, editorId, initial, labels }: Props) {
  const locale = useLocale();
  const id = useId();
  // Sans script : l'envoi du formulaire passe par l'action d'origine.
  const [fallback, fallbackAction] = useActionState(updateSection, initialAuthState);
  const submitted = fallback.status === "error" ? fallback.values : undefined;

  const [draft, setDraft] = useState<Draft>({
    title: submitted?.title ?? initial.title,
    level: submitted?.level ?? initial.level,
    body: submitted?.body ?? initial.body,
  });
  const [version, setVersion] = useState(initial.updatedAt);
  const [status, setStatus] = useState<Status>({ kind: "clean" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<SectionVersion | "gone" | null>(null);
  const [network, setNetwork] = useState<Network>(null);

  const form = useRef<HTMLFormElement>(null);
  const draftRef = useRef(draft);
  const savedRef = useRef<Draft>({ title: initial.title, level: initial.level, body: initial.body });
  const versionRef = useRef(initial.updatedAt);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastSave = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false);
  const networkRef = useRef<Network>(null);
  /** Échecs consécutifs : ils allongent le délai avant l'essai suivant. */
  const failures = useRef(0);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  /** La page est quittée : plus aucun envoi ni aucune reprise ne part. */
  const disposed = useRef(false);

  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (disposed.current) return;
    const wait = Math.max(delay, lastSave.current + MIN_INTERVAL_MS - Date.now(), 0);
    timer.current = setTimeout(() => void saveRef.current(), wait);
  }, []);

  const settle = useCallback((value: Network) => {
    networkRef.current = value;
    setNetwork(value);
  }, []);

  /** Un envoi du texte présent à l'écran, et le traitement de sa réponse. */
  const send = useCallback(async (): Promise<void> => {
    if (disposed.current) return;
    const sent = draftRef.current;
    lastSave.current = Date.now();
    setStatus({ kind: "saving" });
    // L'appel n'a pas abouti : le texte reste à l'écran, l'envoi sera retenté
    // après un délai qui s'allonge, ou dès le retour du réseau.
    const lost = () => {
      failures.current += 1;
      settle(navigator.onLine ? "unreachable" : "offline");
      setStatus({ kind: "unsaved" });
      schedule(retryDelay(failures.current));
    };

    let result: Awaited<ReturnType<typeof saveSectionDraft>>;
    try {
      result = await saveSectionDraft({
        projectId,
        sectionId,
        editorId,
        ...sent,
        updatedAt: versionRef.current,
      });
    } catch {
      return lost();
    }
    settle(null);

    const accept = (updatedAt: string) => {
      failures.current = 0;
      savedRef.current = sent;
      versionRef.current = updatedAt;
      setVersion(updatedAt);
      setFields({});
      // Une frappe pendant l'envoi : il reste des modifications à enregistrer.
      if (same(draftRef.current, sent)) {
        setStatus({ kind: "saved", at: new Date() });
      } else {
        setStatus({ kind: "unsaved" });
        schedule(IDLE_MS);
      }
    };

    const fail = (error: EditorError, fieldErrors: Record<string, string> = {}) => {
      setFields(fieldErrors);
      // Seuls les refus passagers sont retentés ; les autres attendent une correction.
      const retrying = error === "unavailable" || error === "rate_limited";
      setStatus({ kind: "error", error, retrying });
      if (!retrying) {
        failures.current = 0;
        return;
      }
      failures.current += 1;
      const delay = retryDelay(failures.current);
      schedule(error === "rate_limited" ? Math.max(delay, RATE_LIMIT_MS) : delay);
    };

    if (result.status === "saved") return accept(result.updatedAt);

    if (result.error !== "conflict") {
      const code = result.error;
      return fail(ERROR_CODES.find((known) => known === code) ?? "unavailable", result.fields);
    }

    let theirs: Awaited<ReturnType<typeof loadSectionVersion>>;
    try {
      theirs = await loadSectionVersion({ projectId, sectionId });
    } catch {
      return lost();
    }
    // La version n'a pas pu être lue : rien n'est affirmé, l'envoi sera retenté.
    if (theirs.status === "error") return fail(theirs.error);
    if (theirs.status === "gone") {
      blocked.current = true;
      setConflict("gone");
      setStatus({ kind: "unsaved" });
      return;
    }
    // La version enregistrée est celle qui vient d'être envoyée (réponse perdue
    // en route) : ce n'est pas un conflit.
    if (same(stored(theirs.version), stored(sent))) return accept(theirs.version.updatedAt);

    // La référence devient la version enregistrée ailleurs : tant que le texte
    // à l'écran en diffère, il reste à enregistrer.
    blocked.current = true;
    savedRef.current = {
      title: theirs.version.title,
      level: theirs.version.level,
      body: theirs.version.body,
    };
    setConflict(theirs.version);
    setStatus({ kind: "unsaved" });
  }, [projectId, sectionId, editorId, schedule, settle]);

  /** Enregistre ce qui ne l'est pas encore. Rend vrai si plus rien n'est en attente. */
  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    // Un envoi en cours est attendu : le suivant part de son résultat.
    while (inFlight.current) await inFlight.current;
    if (blocked.current) return false;
    if (same(draftRef.current, savedRef.current)) return true;

    const attempt = send();
    inFlight.current = attempt;
    try {
      await attempt;
    } finally {
      inFlight.current = null;
    }
    return !blocked.current && same(draftRef.current, savedRef.current);
  }, [send]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const change = useCallback(
    (patch: Partial<Draft>) => {
      const next = { ...draftRef.current, ...patch };
      draftRef.current = next;
      setDraft(next);
      if (same(next, savedRef.current)) {
        // Revenu au texte enregistré : plus rien à envoyer, ni à signaler.
        if (timer.current) clearTimeout(timer.current);
        if (!inFlight.current) setStatus({ kind: "clean" });
        failures.current = 0;
        settle(null);
        setFields({});
        return;
      }
      if (!inFlight.current) setStatus({ kind: "unsaved" });
      // Réseau absent : l'essai suivant est déjà programmé, la frappe ne le rapproche pas.
      if (!blocked.current && !networkRef.current) schedule(IDLE_MS);
    },
    [schedule, settle],
  );

  // Ce qui a été saisi avant que le script de la page soit prêt est repris tel quel.
  useEffect(() => {
    const read = (name: string) => {
      const field = form.current?.elements.namedItem(name);
      return field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
        ? field.value
        : null;
    };
    const typed = { title: read("title"), level: read("level"), body: read("body") };
    const current = draftRef.current;
    const patch: Partial<Draft> = {};
    if (typed.title !== null && typed.title !== current.title) patch.title = typed.title;
    if (typed.level !== null && typed.level !== current.level) patch.level = typed.level;
    if (typed.body !== null && typed.body !== current.body) patch.body = typed.body;
    if (Object.keys(patch).length > 0) change(patch);
  }, [change]);

  // Quitter la page avec un texte non enregistré.
  const leaveLabel = labels.leave;
  useEffect(() => {
    const dirty = () => !same(draftRef.current, savedRef.current);

    // Fermeture, rechargement, adresse saisie : le navigateur demande confirmation.
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty()) event.preventDefault();
    };
    // Onglet masqué ou page mise de côté : l'enregistrement part tout de suite.
    const flush = () => {
      if (document.visibilityState === "hidden" && dirty()) {
        lastSave.current = 0;
        void saveRef.current();
      }
    };
    // Lien de la page : le texte est enregistré avant de la quitter. Si
    // l'enregistrement échoue, l'utilisateur choisit de rester ou de partir.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || !dirty()) return;
      if (link.target && link.target !== "_self") return;
      event.preventDefault();
      event.stopPropagation();
      lastSave.current = 0;
      void saveRef.current().then((done) => {
        if (done || window.confirm(leaveLabel)) {
          // Départ voulu : le navigateur n'a plus à redemander.
          savedRef.current = draftRef.current;
          window.location.assign(link.href);
        }
      });
    };
    // Autre formulaire de la page (citer, retirer, supprimer) : même règle.
    const onSubmit = (event: SubmitEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLFormElement) || target === form.current || !dirty()) return;
      event.preventDefault();
      event.stopPropagation();
      const submitter = event.submitter instanceof HTMLElement ? event.submitter : undefined;
      lastSave.current = 0;
      void saveRef.current().then((done) => {
        // Enregistrement impossible (hors ligne, conflit) : comme pour un lien,
        // la personne choisit. Elle doit toujours pouvoir se déconnecter.
        if (done || window.confirm(leaveLabel)) {
          savedRef.current = draftRef.current;
          target.requestSubmit(submitter);
        } else {
          form.current?.scrollIntoView({ block: "start" });
        }
      });
    };
    // Page rendue par le cache de retour arrière du navigateur : son texte et
    // ses minuteurs datent d'une autre visite, peut-être d'une autre session.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };

    // Retour du réseau : l'envoi part tout de suite, sans attendre le délai en cours.
    const onOnline = () => {
      if (!dirty() || blocked.current) return;
      failures.current = 0;
      lastSave.current = 0;
      void saveRef.current();
    };
    const onOffline = () => {
      if (networkRef.current === "unreachable") settle("offline");
    };

    disposed.current = false;
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pageshow", onPageShow);
      disposed.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [leaveLabel, settle]);

  const keepMine = () => {
    if (!conflict || conflict === "gone") return;
    versionRef.current = conflict.updatedAt;
    setVersion(conflict.updatedAt);
    blocked.current = false;
    setConflict(null);
    lastSave.current = 0;
    // Texte identique à la version enregistrée : il n'y a rien à envoyer.
    if (same(draftRef.current, savedRef.current)) {
      settle(null);
      setStatus({ kind: "clean" });
    } else void save();
  };

  const takeTheirs = () => {
    if (!conflict || conflict === "gone") return;
    const theirs = { title: conflict.title, level: conflict.level, body: conflict.body };
    draftRef.current = theirs;
    savedRef.current = theirs;
    versionRef.current = conflict.updatedAt;
    setDraft(theirs);
    setVersion(conflict.updatedAt);
    blocked.current = false;
    setConflict(null);
    setFields({});
    failures.current = 0;
    settle(null);
    setStatus({ kind: "clean" });
  };

  const words = countWords(draft.body);
  const wordsLabel = (words === 0 ? labels.words.zero : words === 1 ? labels.words.one : labels.words.other)
    .replace("{count}", new Intl.NumberFormat(locale).format(words));

  // Tant que le réseau manque, l'état le dit, y compris pendant un nouvel essai.
  const statusText = network
    ? labels.status[network]
    : status.kind === "unsaved"
      ? labels.status.unsaved
      : status.kind === "saving"
        ? labels.status.saving
        : status.kind === "saved"
          ? labels.status.savedAt.replace(
              "{time}",
              status.at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
            )
          : "";

  const fieldError = (name: string) => {
    const code = fields[name] ?? (fallback.status === "error" ? fallback.fields?.[name] : undefined);
    if (!code) return null;
    return labels.fieldErrors[code as keyof SectionEditorLabels["fieldErrors"]] ?? labels.errors.validation;
  };
  const titleError = fieldError("title");
  const levelError = fieldError("level");
  const bodyError = fieldError("body");
  const levelLabel = (value: string) =>
    labels.levels.find((option) => option.value === value)?.label ?? value;

  return (
    <form
      ref={form}
      action={fallbackAction}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocked.current) return;
        lastSave.current = 0;
        void save();
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="updatedAt" value={version} />

      <p className="text-sm opacity-80" data-testid="word-count">
        {wordsLabel}
      </p>

      {status.kind === "error" ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {labels.errors[status.error]}
          {status.retrying ? ` ${labels.status.retrying}` : ""}
        </p>
      ) : null}

      {network ? (
        <p role="alert" data-testid="network-alert" className="rounded border border-foreground/40 p-3">
          {labels.network}
        </p>
      ) : null}

      {/* Envoi sans script : la réponse de l'action d'origine. */}
      {fallback.status === "error" && status.kind !== "error" && !conflict ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {fallback.error === "conflict"
            ? labels.conflict.reload
            : (labels.errors[fallback.error as EditorError] ?? labels.errors.unavailable)}
        </p>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          data-testid="conflict"
          className="flex flex-col gap-3 rounded border border-red-700 p-3 dark:border-red-400"
        >
          <p className="font-medium">{labels.conflict.heading}</p>
          {conflict === "gone" ? (
            <p>{labels.conflict.gone}</p>
          ) : (
            <>
              <p>{labels.conflict.intro}</p>
              <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
                <dt className="font-medium">{labels.conflict.theirTitle}</dt>
                <dd data-testid="conflict-title">{conflict.title}</dd>
                <dt className="font-medium">{labels.conflict.theirLevel}</dt>
                <dd>{levelLabel(conflict.level)}</dd>
              </dl>
              <label htmlFor={`${id}-theirs`} className="font-medium">
                {labels.conflict.theirs}
              </label>
              <textarea
                id={`${id}-theirs`}
                readOnly
                rows={6}
                value={conflict.body}
                className={`${fieldClass} opacity-80`}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={keepMine}
                  className="rounded bg-foreground px-4 py-3 font-medium text-background"
                >
                  {labels.conflict.keepMine}
                </button>
                <button
                  type="button"
                  onClick={takeTheirs}
                  className="rounded border border-foreground/40 px-4 py-3 font-medium"
                >
                  {labels.conflict.takeTheirs}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-title`} className="font-medium">
          {labels.title}
        </label>
        <input
          id={`${id}-title`}
          name="title"
          type="text"
          maxLength={300}
          required
          autoComplete="off"
          value={draft.title}
          onChange={(event) => change({ title: event.target.value })}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? `${id}-title-error` : undefined}
          className={fieldClass}
        />
        {titleError ? (
          <p id={`${id}-title-error`} className="text-sm text-red-800 dark:text-red-300">
            {titleError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-level`} className="font-medium">
          {labels.level}
        </label>
        <select
          id={`${id}-level`}
          name="level"
          required
          value={draft.level}
          onChange={(event) => change({ level: event.target.value })}
          aria-invalid={levelError ? true : undefined}
          aria-describedby={levelError ? `${id}-level-error` : undefined}
          className={fieldClass}
        >
          <option value="">{labels.choose}</option>
          {labels.levels.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {levelError ? (
          <p id={`${id}-level-error`} className="text-sm text-red-800 dark:text-red-300">
            {levelError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-body`} className="font-medium">
          {labels.body}
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          rows={18}
          maxLength={SECTION_BODY_MAX}
          value={draft.body}
          onChange={(event) => change({ body: event.target.value })}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={`${id}-body-hint${bodyError ? ` ${id}-body-error` : ""}`}
          className={fieldClass}
        />
        <p id={`${id}-body-hint`} className="text-sm opacity-70">
          {labels.bodyHint}
        </p>
        {bodyError ? (
          <p id={`${id}-body-error`} className="text-sm text-red-800 dark:text-red-300">
            {bodyError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status.kind === "saving" || conflict !== null}
          className="rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
        >
          {status.kind === "saving" ? labels.pending : labels.save}
        </button>
        <p role="status" data-testid="save-status" className="text-sm opacity-80">
          {statusText}
        </p>
      </div>
    </form>
  );
}
