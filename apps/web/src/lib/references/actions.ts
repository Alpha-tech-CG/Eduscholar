"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { producedFlag, producedRows, refusalCode, succeeded } from "@/lib/admin/responses";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { createSessionClient } from "@/lib/supabase/server";
import {
  buildReferencePayload,
  labelsFromForm,
  REFERENCE_KINDS,
  REFERENCE_SHAPES,
  referenceActiveSchema,
  referenceQuery,
  type ReferenceKind,
} from "./schemas";

// Administration des référentiels. Chaque action appelle une fonction de la
// base sous la session de l'administrateur : rôle, second facteur récent,
// référentiels en lecture seule, codes protégés, dernière ligne active et
// journalisation y sont tenus. Ces actions ne font que valider la forme des
// entrées et traduire le résultat.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Retour à la liste : même référentiel, même filtre, même page. */
async function backToList(kind: ReferenceKind, formData: FormData, notice: string): Promise<never> {
  const q = referenceQuery(text(formData, "q"));
  const page = text(formData, "page");
  const locale = await getLocale();
  return redirect({
    href: {
      pathname: "/admin/references",
      query: {
        kind,
        ...(q ? { q } : {}),
        ...(/^\d{1,3}$/.test(page) && page !== "1" ? { page } : {}),
        notice,
      },
    },
    locale,
  });
}

/** Crée une ligne (inactive) ou modifie celle qui existe, selon le formulaire. */
export async function saveReferenceItem(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const kind = REFERENCE_KINDS.find((value) => value === text(formData, "kind"));
  const mode = text(formData, "mode") === "create" ? "create" : "update";
  if (!kind) return invalid;

  const labels = labelsFromForm(formData);
  const input = {
    code: text(formData, "code").slice(0, 60),
    parentCode: text(formData, "parentCode").slice(0, 60),
    labels,
    position: text(formData, "position").slice(0, 10),
    iscedLevel: text(formData, "iscedLevel").slice(0, 3),
  };
  const values: Record<string, string> = {
    code: input.code,
    parentCode: input.parentCode,
    position: input.position,
    iscedLevel: input.iscedLevel,
    ...Object.fromEntries(Object.entries(labels).map(([language, value]) => [`label_${language}`, value])),
  };

  const built = buildReferencePayload(kind, input, mode);
  if (!built.ok) {
    return { status: "error", error: "validation", fields: { [built.field]: built.error }, values };
  }

  const supabase = await createSessionClient();

  if (mode === "create") {
    // La fonction de la base modifie la ligne quand le code existe déjà : le
    // formulaire de création, lui, ne doit pas réécrire une ligne par mégarde.
    // Ce n'est qu'un garde-fou de saisie, lu sur la liste que l'administrateur
    // voit ; la base reste seule juge de ce qui s'écrit.
    const existing = await supabase.rpc("admin_reference_items", { kind });
    const rows = producedRows(existing);
    if (!rows) return { status: "error", error: refusalCode(existing), values };
    const parent = REFERENCE_SHAPES[kind].parentIsKey ? built.payload.program_code : undefined;
    const taken = rows.some((row) => {
      const item = row as { code?: unknown; program_code?: unknown };
      return item.code === built.payload.code && (parent === undefined || item.program_code === parent);
    });
    if (taken) {
      return { status: "error", error: "reference_code_taken", fields: { code: "invalid_reference_code" }, values };
    }
  }

  const response = await supabase.rpc("admin_save_reference_item", { kind, payload: built.payload });
  // L'écriture n'est tenue pour faite que si la base rend son drapeau.
  const created = producedFlag(response, "created");
  if (created === null) return { status: "error", error: refusalCode(response), values };

  return backToList(kind, formData, created ? "created" : "updated");
}

export async function setReferenceActive(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = referenceActiveSchema.safeParse({
    kind: text(formData, "kind"),
    code: text(formData, "code"),
    parentCode: text(formData, "parentCode"),
    active: text(formData, "active"),
  });
  if (!parsed.success) return invalid;

  const supabase = await createSessionClient();
  const response = await supabase.rpc("admin_set_reference_active", {
    kind: parsed.data.kind,
    code: parsed.data.code,
    active: parsed.data.active,
    ...(REFERENCE_SHAPES[parsed.data.kind].parentIsKey ? { parent_code: parsed.data.parentCode } : {}),
  });
  // Un refus de la base porte son code ; elle l'a déjà consigné.
  if (!succeeded(response)) return { status: "error", error: refusalCode(response) };

  return backToList(parsed.data.kind, formData, parsed.data.active ? "activated" : "deactivated");
}
