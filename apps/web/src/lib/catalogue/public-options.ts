import "server-only";
import type { PublicSearchOptions } from "@/components/catalogue/public-search";
import { getReferenceData } from "@/lib/profile/queries";
import { getCatalogueReference } from "./queries";
import type { PublicSearchReference } from "./search";

/** Choix des filtres de la recherche sans compte, dans la langue demandée. */
export async function getPublicSearchOptions(
  locale: string,
): Promise<{ options: PublicSearchOptions; reference: PublicSearchReference }> {
  const [reference, catalogue] = await Promise.all([
    getReferenceData(locale),
    getCatalogueReference(locale),
  ]);
  const options: PublicSearchOptions = {
    types: catalogue.types,
    languages: catalogue.languages,
    levels: reference.levels,
    programs: reference.programs,
    countries: reference.countries,
  };
  return {
    options,
    reference: {
      types: options.types.map(({ code }) => code),
      languages: options.languages.map(({ code }) => code),
      levels: options.levels.map(({ code }) => code),
      programs: options.programs.map(({ code }) => code),
      countries: options.countries.map(({ code }) => code),
    },
  };
}
