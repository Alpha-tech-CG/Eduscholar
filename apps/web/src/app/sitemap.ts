import type { MetadataRoute } from "next";
import { getSitemapResources } from "@/lib/catalogue/public-queries";
import { serverEnv } from "@/lib/env.server";
import { buildSitemap } from "@/lib/seo/public-pages";

// Lu à chaque demande : une fiche suspendue ou retirée sort aussitôt du plan,
// et la construction ne dépend pas de la base.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Base injoignable : le plan des seules pages fixes, plutôt qu'une erreur.
  const resources = (await getSitemapResources()) ?? [];
  return buildSitemap(serverEnv().APP_URL, resources);
}
