"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { initialAuthState, type AuthFormState } from "@/lib/auth/state";

type Action = (previous: AuthFormState, formData: FormData) => Promise<AuthFormState>;

const FormStateContext = createContext<{ state: AuthFormState; pending: boolean }>({
  state: initialAuthState,
  pending: false,
});

type AuthFormProps = {
  action: Action;
  submitLabel: string;
  pendingLabel: string;
  children: ReactNode;
  /** Bouton d'une action irréversible. */
  destructive?: boolean;
};

/**
 * Formulaire d'authentification. Fonctionne sans JavaScript ; avec, il affiche
 * l'état d'envoi et les erreurs renvoyées par le serveur.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  destructive = false,
}: AuthFormProps) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(action, initialAuthState);
  const feedback = useRef<HTMLDivElement>(null);

  // Le message est annoncé et rendu visible dès qu'il change.
  useEffect(() => {
    if (state.status !== "idle") feedback.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <div
        ref={feedback}
        tabIndex={-1}
        role="status"
        className="rounded border border-foreground/20 p-4 outline-none"
      >
        {t(`notices.${state.notice}`)}
      </div>
    );
  }

  return (
    <FormStateContext value={{ state, pending }}>
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <div ref={feedback} tabIndex={-1} aria-live="assertive" className="outline-none">
          {state.status === "error" ? (
            <p role="alert" className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
              {t(`errors.${state.error}`)}
            </p>
          ) : null}
        </div>
        {children}
        <button
          type="submit"
          disabled={pending}
          className={
            destructive
              ? "rounded bg-red-800 px-4 py-3 font-medium text-white disabled:opacity-60"
              : "rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
          }
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
    </FormStateContext>
  );
}

type TextFieldProps = {
  name: string;
  label: string;
  /** "code" : code à usage unique, saisi sur un clavier numérique. */
  type: "email" | "password" | "code";
  autoComplete: string;
  hint?: string;
};

export function TextField({ name, label, type, autoComplete, hint }: TextFieldProps) {
  const t = useTranslations("Auth");
  const { state } = useContext(FormStateContext);
  const error = state.status === "error" ? state.fields?.[name] : undefined;
  const value = state.status === "error" ? state.values?.[name] : undefined;
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type === "code" ? "text" : type}
        inputMode={type === "code" ? "numeric" : undefined}
        maxLength={type === "code" ? 12 : undefined}
        autoComplete={autoComplete}
        required
        // Ni un mot de passe ni un code ne sont renvoyés par le serveur.
        defaultValue={type === "email" ? value : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="rounded border border-foreground/30 bg-background px-3 py-2 aria-[invalid=true]:border-red-700"
      />
      {hint ? (
        <p id={`${name}-hint`} className="text-sm opacity-70">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-red-800 dark:text-red-300">
          {t(`fieldErrors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

type CheckboxFieldProps = { name: string; label: string };

export function CheckboxField({ name, label }: CheckboxFieldProps) {
  const t = useTranslations("Auth");
  const { state } = useContext(FormStateContext);
  const error = state.status === "error" ? state.fields?.[name] : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name={name}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${name}-error` : undefined}
          className="mt-1 size-4"
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={`${name}-error`} className="text-sm text-red-800 dark:text-red-300">
          {t(`fieldErrors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

type Choice = { value: string; label: string };

type SelectFieldProps = {
  name: string;
  label: string;
  options: Choice[];
  defaultValue?: string;
  placeholder: string;
  required?: boolean;
};

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  required = false,
}: SelectFieldProps) {
  const t = useTranslations("Auth");
  const { state } = useContext(FormStateContext);
  const error = state.status === "error" ? state.fields?.[name] : undefined;
  // Après une erreur, la valeur saisie est reprise plutôt que la valeur d'origine.
  const submitted = state.status === "error" ? state.values?.[name] : undefined;
  // Identifiant propre à ce champ : une page peut porter plusieurs formulaires
  // ayant une liste du même nom (un par signalement, par exemple).
  const id = `${name}-${useId()}`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        key={submitted ?? defaultValue ?? ""}
        defaultValue={submitted ?? defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="rounded border border-foreground/30 bg-background px-3 py-2 aria-[invalid=true]:border-red-700"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-800 dark:text-red-300">
          {t(`fieldErrors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

type OptionalTextFieldProps = {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  maxLength: number;
  required?: boolean;
  /** "url" et "numeric" adaptent le clavier sur mobile. */
  kind?: "text" | "url" | "numeric";
  /** Plusieurs lignes. */
  rows?: number;
};

export function OptionalTextField({
  name,
  label,
  hint,
  defaultValue,
  maxLength,
  required = false,
  kind = "text",
  rows,
}: OptionalTextFieldProps) {
  const t = useTranslations("Auth");
  const { state } = useContext(FormStateContext);
  // Identifiant propre à ce champ : une page peut porter plusieurs formulaires
  // ayant un champ du même nom, et deux éléments ne partagent jamais un id.
  const id = `${name}-${useId()}`;
  const error = state.status === "error" ? state.fields?.[name] : undefined;
  const submitted = state.status === "error" ? state.values?.[name] : undefined;
  const value = submitted ?? defaultValue;
  const className =
    "rounded border border-foreground/30 bg-background px-3 py-2 aria-[invalid=true]:border-red-700";
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {rows ? (
        <textarea
          id={id}
          name={name}
          rows={rows}
          maxLength={maxLength}
          required={required}
          defaultValue={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={className}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={kind === "url" ? "url" : "text"}
          inputMode={kind === "numeric" ? "numeric" : undefined}
          maxLength={maxLength}
          required={required}
          defaultValue={value}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={className}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm opacity-70">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-800 dark:text-red-300">
          {t(`fieldErrors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

type CheckboxGroupProps = {
  name: string;
  legend: string;
  options: Choice[];
  defaultValues: string[];
};

export function CheckboxGroup({ name, legend, options, defaultValues }: CheckboxGroupProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium">{legend}</legend>
      <div className="grid max-h-64 gap-x-4 gap-y-1 overflow-y-auto rounded border border-foreground/20 p-3 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={defaultValues.includes(option.value)}
              className="mt-1 size-4"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
