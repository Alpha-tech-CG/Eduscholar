import type { MetadataRoute } from "next";
import { serverEnv } from "@/lib/env.server";
import { buildRobots } from "@/lib/seo/public-pages";

// L'adresse du plan vient de l'environnement du serveur, lu à la demande.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(serverEnv().APP_URL);
}
