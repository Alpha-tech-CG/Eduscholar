"use client";

import { useActionState } from "react";
import { createShareLink, type ShareLinkState } from "@/lib/projects/sharing-actions";

const initial: ShareLinkState = { status: "idle" };

export type ShareLinkLabels = {
  role: string;
  roles: { value: string; label: string }[];
  create: string;
  /** Quand un lien existe déjà : le créer le remplace. */
  replace: string;
  pending: string;
  created: string;
  linkLabel: string;
  keepSafe: string;
  errors: Record<string, string>;
  fallbackError: string;
};

type Props = { projectId: string; hasLink: boolean; labels: ShareLinkLabels };

/** Création du lien de partage. Il n'est affiché qu'une fois : la base n'en garde que l'empreinte. */
export function ShareLinkForm({ projectId, hasLink, labels }: Props) {
  const [state, create, pending] = useActionState(createShareLink, initial);

  if (state.status === "created") {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="rounded border border-foreground/20 p-3">
          {labels.created}
        </p>
        <label htmlFor="share-link" className="font-medium">
          {labels.linkLabel}
        </label>
        <input
          id="share-link"
          data-testid="share-link"
          readOnly
          value={state.link}
          className="rounded border border-foreground/30 bg-background px-3 py-2 font-mono text-sm"
        />
        <p className="text-sm opacity-80">{labels.keepSafe}</p>
      </div>
    );
  }

  return (
    <form action={create} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      {state.status === "error" ? (
        <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
          {labels.errors[state.error] ?? labels.fallbackError}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="share-link-role" className="font-medium">
          {labels.role}
        </label>
        <select
          id="share-link-role"
          name="role"
          defaultValue="viewer"
          className="rounded border border-foreground/30 bg-background px-3 py-2"
        >
          {labels.roles.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
      >
        {pending ? labels.pending : hasLink ? labels.replace : labels.create}
      </button>
    </form>
  );
}
