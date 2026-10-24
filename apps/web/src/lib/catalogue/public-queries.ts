import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { SITEMAP_REVALIDATE_SECONDS } from "@/lib/seo/public-pages";
import { createAnonymousClient } from "@/lib/supabase/server";
import {
  parseHomeSections,
  parsePublicResource,
  parsePublicSearch,
  parseSitemapResources,
  type HomeSections,
  type PublicResource,
  type PublicSearchPage,
} from "./public-resource";
import { searchTerms, type PublicSearchFilters } from "./search";

// Lectures du catalogue public (ADR-0014), sous le rôle `anon`, sans session.
// La base ne rend que les fiches publiées et publiques, colonne par colonne.
// Rien de ce qui est lu ici n'est écrit dans les journaux.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Une fiche publique, ou `null` : inexistante, non publiée et réservée se confondent. */
export const getPublicResource = cache(async (id: string): Promise<PublicResource | null> => {
  if (!UUID.test(id)) return null;
  const { data, error } = await createAnonymousClient().rpc("public_resource", { resource_id: id });
  if (error || !data) return null;
  return parsePublicResource(data);
});

export type PublicSearchResult = PublicSearchPage & { failed: boolean };

/** Recherche sans compte. La limite de débit est vérifiée par l'appelant. */
export async function searchPublicResources(filters: PublicSearchFilters): Promise<PublicSearchResult> {
  const { data, error } = await createAnonymousClient().rpc("public_search_resources", {
    payload: {
      terms: searchTerms(filters.query),
      type: filters.typeCode,
      language: filters.languageCode,
      access: filters.accessStatus,
      level: filters.levelCode,
      program: filters.programCode,
      country: filters.countryCode,
      page: filters.page,
    },
  });
  const page = error ? null : parsePublicSearch(data);
  if (!page) return { resources: [], total: 0, capped: false, failed: true };

  // Page au-delà de la dernière : on revient à la première.
  if (page.resources.length === 0 && page.total > 0 && filters.page > 1) {
    return searchPublicResources({ ...filters, page: 1 });
  }
  return { ...page, failed: false };
}

const EMPTY_SECTIONS: HomeSections = { recent: [], popular: [], institutional: [] };

/** Sections de l'accueil. Vides si la base ne répond pas : l'accueil s'affiche quand même. */
export async function getHomeSections(): Promise<HomeSections> {
  const { data, error } = await createAnonymousClient().rpc("public_home_sections");
  return error ? EMPTY_SECTIONS : parseHomeSections(data);
}

// Lecture partagée entre les requêtes (MOYEN-1 a). Une erreur lève : elle
// n'est pas mise en cache, la demande suivante réessaie.
const cachedSitemapResources = unstable_cache(
  async (): Promise<{ id: string; updatedAt: string }[]> => {
    const { data, error } = await createAnonymousClient().rpc("public_sitemap_resources");
    if (error) throw new Error("sitemap_unavailable");
    return parseSitemapResources(data);
  },
  ["public-sitemap-resources"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);

/** Fiches du plan du site. `null` si la base ne répond pas. */
export async function getSitemapResources(): Promise<{ id: string; updatedAt: string }[] | null> {
  try {
    return await cachedSitemapResources();
  } catch {
    return null;
  }
}
