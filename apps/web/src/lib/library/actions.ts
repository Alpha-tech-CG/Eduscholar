"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";
import { collectionSchema, savedItemSchema } from "./schemas";

// Actions de la bibliothèque personnelle. Chacune appelle une fonction nommée
// de la base, sous la session de l'utilisateur : la base vérifie que la
// collection est la sienne, que la fiche est publiée, et tient les plafonds.

const expired: AuthFormState = { status: "error", error: "session_expired" };
const invalid: AuthFormState = { status: "error", error: "validation" };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function fieldErrors(error: z.ZodError): Record<string, "required" | "too_long"> {
  const fields: Record<string, "required" | "too_long"> = {};
  for (const issue of error.issues) {
    const name = String(issue.path[0] ?? "");
    if (name && !fields[name]) fields[name] = issue.message === "too_long" ? "too_long" : "required";
  }
  return fields;
}

/** Ajoute ou retire un favori, depuis la fiche ou depuis la bibliothèque. */
export async function setFavorite(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = savedItemSchema.safeParse({
    resourceId: text(formData, "resourceId"),
    present: text(formData, "present"),
  });
  if (!parsed.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_favorite", {
    resource_id: parsed.data.resourceId,
    favorite: parsed.data.present,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  const notice = parsed.data.present ? "favorite-added" : "favorite-removed";
  return text(formData, "from") === "library"
    ? redirect({ href: { pathname: "/library", query: { notice } }, locale })
    : redirect({
        href: { pathname: `/resources/${parsed.data.resourceId}`, query: { notice } },
        locale,
      });
}

export async function createCollection(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const values = {
    name: text(formData, "name").slice(0, 200),
    description: text(formData, "description").slice(0, 1200),
  };
  const parsed = collectionSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: fieldErrors(parsed.error), values };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("create_collection", {
    name: parsed.data.name,
    description: parsed.data.description ?? "",
  });
  if (error || typeof data !== "string") {
    return { status: "error", error: error ? catalogueErrorCode(error) : "unavailable", values };
  }

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/library/collections/${data}`, query: { notice: "created" } },
    locale,
  });
}

export async function updateCollection(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const collectionId = z.uuid().safeParse(text(formData, "collectionId"));
  const values = {
    name: text(formData, "name").slice(0, 200),
    description: text(formData, "description").slice(0, 1200),
  };
  const parsed = collectionSchema.safeParse(values);
  if (!collectionId.success) return invalid;
  if (!parsed.success) {
    return { status: "error", error: "validation", fields: fieldErrors(parsed.error), values };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("update_collection", {
    collection_id: collectionId.data,
    name: parsed.data.name,
    description: parsed.data.description ?? "",
  });
  if (error) return { status: "error", error: catalogueErrorCode(error), values };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/library/collections/${collectionId.data}`, query: { notice: "updated" } },
    locale,
  });
}

export async function deleteCollection(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const collectionId = z.uuid().safeParse(text(formData, "collectionId"));
  if (!collectionId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("delete_collection", { collection_id: collectionId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/library", query: { notice: "deleted" } }, locale });
}

/** Range une fiche dans une collection, ou l'en retire. */
export async function setCollectionItem(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const collectionId = z.uuid().safeParse(text(formData, "collectionId"));
  const parsed = savedItemSchema.safeParse({
    resourceId: text(formData, "resourceId"),
    present: text(formData, "present"),
  });
  if (!collectionId.success || !parsed.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_collection_item", {
    collection_id: collectionId.data,
    resource_id: parsed.data.resourceId,
    present: parsed.data.present,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  const notice = parsed.data.present ? "item-added" : "item-removed";
  return text(formData, "from") === "collection"
    ? redirect({
        href: { pathname: `/library/collections/${collectionId.data}`, query: { notice } },
        locale,
      })
    : redirect({
        href: { pathname: `/resources/${parsed.data.resourceId}`, query: { notice } },
        locale,
      });
}
