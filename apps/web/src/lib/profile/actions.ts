"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { getFullySignedInUser } from "@/lib/auth/session";
import type { AuthFormState } from "@/lib/auth/state";
import { createSessionClient } from "@/lib/supabase/server";
import { getOwnProfile } from "./queries";
import { profileFieldErrors, profileSchema } from "./schemas";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function list(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
}

/**
 * Enregistre le profil académique de l'utilisateur courant.
 *
 * L'écriture se fait sous son jeton : la RLS limite la mise à jour à sa propre
 * ligne, et la base contrôle chaque valeur. L'identifiant de l'utilisateur ne
 * vient jamais du formulaire.
 */
export async function saveProfile(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getFullySignedInUser();
  if (!user) return { status: "error", error: "session_expired" };

  const current = await getOwnProfile();
  const parsed = profileSchema.safeParse({
    countryCode: text(formData, "countryCode"),
    levelCode: text(formData, "levelCode"),
    programCode: text(formData, "programCode"),
    specialtyCode: text(formData, "specialtyCode"),
    subjectCodes: list(formData, "subjectCodes"),
    institutionName: text(formData, "institutionName"),
    goals: list(formData, "goals"),
    preferredLocale: text(formData, "preferredLocale"),
    ageConfirmed: text(formData, "ageConfirmed") === "on",
  });
  if (!parsed.success) {
    return {
      status: "error",
      error: "validation",
      fields: profileFieldErrors(parsed.error),
    };
  }

  const alreadyConfirmed = current?.ageConfirmed ?? false;
  if (!alreadyConfirmed && !parsed.data.ageConfirmed) {
    return { status: "error", error: "validation", fields: { ageConfirmed: "age_required" } };
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      country_code: parsed.data.countryCode,
      level_code: parsed.data.levelCode,
      program_code: parsed.data.programCode,
      specialty_code: parsed.data.specialtyCode ?? null,
      subject_codes: parsed.data.subjectCodes,
      institution_name: parsed.data.institutionName ?? null,
      goals: parsed.data.goals,
      preferred_locale: parsed.data.preferredLocale,
      // Simple signal : la base ignore la valeur et date elle-même la déclaration.
      ...(alreadyConfirmed ? {} : { age_confirmed_at: new Date().toISOString() }),
    })
    .eq("user_id", user.id)
    .select("user_id");

  if (error) {
    // Refus d'une contrainte ou d'une clé étrangère : valeur hors référentiel.
    if (error.code === "23514" || error.code === "23503") {
      return { status: "error", error: "validation" };
    }
    return { status: "error", error: "unavailable" };
  }
  // La RLS filtre sans lever d'erreur (compte suspendu, par exemple) : sans
  // ligne modifiée, rien n'a été enregistré.
  if (data?.length !== 1) return { status: "error", error: "unavailable" };

  // La page suivante s'affiche dans la langue choisie.
  const current_locale = await getLocale();
  const locale = hasLocale(routing.locales, parsed.data.preferredLocale)
    ? parsed.data.preferredLocale
    : current_locale;

  return redirect({
    href: { pathname: "/account", query: { notice: "profile-saved" } },
    locale,
  });
}
