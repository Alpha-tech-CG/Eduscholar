import "server-only";
import { cache } from "react";
import { z } from "zod";
import { labelFallbacks } from "@/i18n/routing";
import { hasSessionCookie } from "@/lib/auth/session-cookie";
import { createAnonymousClient, createSessionClient } from "@/lib/supabase/server";

// Référentiels de la plateforme (pays, langues, licences, types, niveaux,
// domaines, programmes, spécialités, matières). La base les rend en une fois,
// par une fonction : les tables ne se lisent pas par l'API, et ne peuvent donc
// pas servir de maillon à une requête imbriquée (dette D-15).

const labels = z.record(z.string(), z.string()).nullable().catch(null);
const coded = z.object({ code: z.string(), labels });
const scoped = coded.extend({ program_code: z.string() });

const schema = z.object({
  countries: z.array(coded),
  languages: z.array(coded),
  licenses: z.array(coded.extend({ can_host: z.string() })),
  resource_types: z.array(coded),
  education_levels: z.array(coded),
  academic_domains: z.array(coded),
  academic_programs: z.array(coded.extend({ domain_code: z.string().nullable() })),
  program_specialties: z.array(scoped),
  subjects: z.array(scoped),
});

export type RawReference = z.infer<typeof schema>;

const EMPTY: RawReference = {
  countries: [],
  languages: [],
  licenses: [],
  resource_types: [],
  education_levels: [],
  academic_domains: [],
  academic_programs: [],
  program_specialties: [],
  subjects: [],
};

/** Une lecture par requête de page. Vide si la base refuse ou ne répond pas. */
export const getRawReference = cache(async (): Promise<RawReference> => {
  // Un visiteur lit les mêmes référentiels par la fonction publique
  // (ADR-0014) ; une session périmée aussi, plutôt qu'une page sans libellés.
  let result = (await hasSessionCookie())
    ? await (await createSessionClient()).rpc("reference_data")
    : null;
  if (!result || result.error) result = await createAnonymousClient().rpc("public_reference_data");
  const { data, error } = result;
  if (error) return EMPTY;
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : EMPTY;
});

/** Libellé dans la langue demandée, à défaut en anglais, puis en français. */
export function referenceLabel(labels: Record<string, string> | null, locale: string): string {
  for (const language of labelFallbacks(locale)) {
    const value = labels?.[language];
    if (value) return value;
  }
  return "";
}
