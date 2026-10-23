import { getRawReference, referenceLabel } from "@/lib/reference/data";
import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/server";

// Lectures faites sous le jeton de l'utilisateur : la RLS ne renvoie que sa
// propre ligne. Les colonnes sont nommées une à une (modèle de menaces M-52).

export type Profile = {
  preferredLocale: string;
  countryCode: string | null;
  levelCode: string | null;
  programCode: string | null;
  specialtyCode: string | null;
  subjectCodes: string[];
  institutionName: string | null;
  goals: string[];
  ageConfirmed: boolean;
  onboarded: boolean;
};

export const getOwnProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "preferred_locale, country_code, level_code, program_code, specialty_code, subject_codes, institution_name, goals, age_confirmed_at, onboarded_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  return {
    preferredLocale: data.preferred_locale,
    countryCode: data.country_code,
    levelCode: data.level_code,
    programCode: data.program_code,
    specialtyCode: data.specialty_code,
    subjectCodes: data.subject_codes,
    institutionName: data.institution_name,
    goals: data.goals,
    ageConfirmed: data.age_confirmed_at !== null,
    onboarded: data.onboarded_at !== null,
  };
});

export type Option = { code: string; label: string };
export type ScopedOption = Option & { programCode: string };

export type ReferenceData = {
  countries: Option[];
  levels: Option[];
  programs: Option[];
  specialties: ScopedOption[];
  subjects: ScopedOption[];
};

type Labels = Record<string, string> | null;

function label(labels: unknown, locale: string): string {
  return referenceLabel((labels ?? null) as Labels, locale);
}

/** Référentiels dans la langue demandée. Les pays sont triés selon cette langue. */
export const getReferenceData = cache(async (locale: string): Promise<ReferenceData> => {
  const reference = await getRawReference();
  const countries = { data: reference.countries };
  const levels = { data: reference.education_levels };
  const programs = { data: reference.academic_programs };
  const specialties = { data: reference.program_specialties };
  const subjects = { data: reference.subjects };

  const collator = new Intl.Collator(locale);

  return {
    countries: (countries.data ?? [])
      .map((row) => ({ code: row.code, label: label(row.labels, locale) }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    levels: (levels.data ?? []).map((row) => ({
      code: row.code,
      label: label(row.labels, locale),
    })),
    programs: (programs.data ?? []).map((row) => ({
      code: row.code,
      label: label(row.labels, locale),
    })),
    specialties: (specialties.data ?? []).map((row) => ({
      programCode: row.program_code,
      code: row.code,
      label: label(row.labels, locale),
    })),
    subjects: (subjects.data ?? []).map((row) => ({
      programCode: row.program_code,
      code: row.code,
      label: label(row.labels, locale),
    })),
  };
});
