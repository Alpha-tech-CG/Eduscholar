"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { catalogueErrorCode } from "@/lib/catalogue/errors";
import { createSessionClient } from "@/lib/supabase/server";
import { collectionSchema, noteSchema, parseTag, savedItemSchema, tagSchema } from "./schemas";

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

/** Retour à la bibliothèque, en gardant le filtre par tag s'il y en a un. */
function libraryHref(notice: string, formData: FormData) {
  const tag = parseTag(text(formData, "returnTag"));
  return { pathname: "/library", query: tag ? { notice, tag } : { notice } };
}

/** Enregistre, ou efface si elle est vide, la note privée d'un favori. */
export async function setFavoriteNote(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const resourceId = z.uuid().safeParse(text(formData, "resourceId"));
  const note = noteSchema.safeParse(text(formData, "note").slice(0, 4000));
  if (!resourceId.success) return invalid;
  if (!note.success) return { status: "error", error: "validation", fields: { note: "too_long" } };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_favorite_note", {
    resource_id: resourceId.data,
    note: note.data,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: libraryHref("note-saved", formData), locale });
}

/** Note privée d'un élément de collection. */
export async function setCollectionItemNote(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const collectionId = z.uuid().safeParse(text(formData, "collectionId"));
  const resourceId = z.uuid().safeParse(text(formData, "resourceId"));
  const note = noteSchema.safeParse(text(formData, "note").slice(0, 4000));
  if (!collectionId.success || !resourceId.success) return invalid;
  if (!note.success) return { status: "error", error: "validation", fields: { note: "too_long" } };

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_collection_item_note", {
    collection_id: collectionId.data,
    resource_id: resourceId.data,
    note: note.data,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: { pathname: `/library/collections/${collectionId.data}`, query: { notice: "note-saved" } },
    locale,
  });
}

/** Pose ou retire un tag personnel sur un favori. */
export async function setFavoriteTag(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const parsed = savedItemSchema.safeParse({
    resourceId: text(formData, "resourceId"),
    present: text(formData, "present"),
  });
  const tag = tagSchema.safeParse(text(formData, "tag").slice(0, 200));
  if (!parsed.success) return invalid;
  if (!tag.success) {
    const code = tag.error.issues[0]?.message;
    return {
      status: "error",
      error: "validation",
      fields: { tag: code === "too_long" || code === "invalid_choice" ? code : "required" },
    };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_favorite_tag", {
    resource_id: parsed.data.resourceId,
    tag: tag.data,
    present: parsed.data.present,
  });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: libraryHref(parsed.data.present ? "tag-added" : "tag-removed", formData),
    locale,
  });
}

/** Efface une ligne de l'historique de consultation. */
export async function deleteResourceView(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const resourceId = z.uuid().safeParse(text(formData, "resourceId"));
  if (!resourceId.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("delete_resource_view", { resource_id: resourceId.data });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/library/history", query: { notice: "entry-deleted" } }, locale });
}

/** Efface tout l'historique de consultation. */
export async function clearResourceViews(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;
  if (text(formData, "confirm") !== "on") {
    return { status: "error", error: "validation", fields: { confirm: "required" } };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("clear_resource_views");
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({ href: { pathname: "/library/history", query: { notice: "cleared" } }, locale });
}

/** Active ou désactive l'historique ; le désactiver l'efface. */
export async function setHistoryEnabled(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await getFullySignedInUser())) return expired;

  const enabled = z.enum(["true", "false"]).safeParse(text(formData, "enabled"));
  if (!enabled.success) return invalid;

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("set_history_enabled", { enabled: enabled.data === "true" });
  if (error) return { status: "error", error: catalogueErrorCode(error) };

  const locale = await getLocale();
  return redirect({
    href: {
      pathname: "/library/history",
      query: { notice: enabled.data === "true" ? "enabled" : "disabled" },
    },
    locale,
  });
}
