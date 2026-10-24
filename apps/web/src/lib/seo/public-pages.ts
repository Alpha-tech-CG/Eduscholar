// Plan du site et règles d'exploration (ADR-0014). Module pur.

import type { MetadataRoute } from "next";
import { HELP_TOPICS } from "@/content/help/types";
import { LEGAL_PAGES } from "@/content/legal/types";
import { locales } from "@/i18n/routing";
import { alternateLanguages, localizedUrl } from "@/lib/catalogue/public-resource";

/**
 * Durée de conservation de la liste des fiches du plan du site, en secondes.
 * Le plan est demandé par chaque robot : la base n'est relue qu'une fois par
 * période. Une fiche suspendue peut y rester jusqu'à cette durée ; sa page,
 * elle, répond introuvable aussitôt.
 */
export const SITEMAP_REVALIDATE_SECONDS = 300;

/** Pages publiques fixes, sans préfixe de langue. */
export const STATIC_PUBLIC_PATHS: readonly string[] = [
  "/",
  "/help",
  ...HELP_TOPICS.map((topic) => `/help/${topic}`),
  ...LEGAL_PAGES.map((page) => `/legal/${page}`),
];

/**
 * Espaces réservés aux comptes, ou sans intérêt pour un moteur : refusés à
 * l'exploration, dans chaque langue. La recherche aussi : ses pages sont en
 * nombre infini, et le plan du site mène déjà à chaque fiche.
 */
export const DISALLOWED_SEGMENTS: readonly string[] = [
  "account",
  "admin",
  "moderation",
  "projects",
  "library",
  "contribute",
  "contributions",
  "notifications",
  "organizations",
  "recommendations",
  "invitations",
  "join",
  "shared",
  "unsubscribe",
  "search",
  "sign-in",
  "sign-up",
  "forgot-password",
  "reset-password",
  "auth",
];

export function buildRobots(appUrl: string): MetadataRoute.Robots {
  const base = appUrl.replace(/\/+$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        ...locales.flatMap((locale) => DISALLOWED_SEGMENTS.map((segment) => `/${locale}/${segment}`)),
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}

/** Une entrée par page et par langue, chacune avec ses versions linguistiques. */
export function buildSitemap(
  appUrl: string,
  resources: readonly { id: string; updatedAt: string }[],
): MetadataRoute.Sitemap {
  const entry = (path: string, lastModified?: string) =>
    locales.map((locale) => ({
      url: localizedUrl(appUrl, locale, path),
      ...(lastModified ? { lastModified } : {}),
      alternates: { languages: alternateLanguages(appUrl, path) },
    }));

  return [
    ...STATIC_PUBLIC_PATHS.flatMap((path) => entry(path)),
    ...resources.flatMap(({ id, updatedAt }) => entry(`/resources/${id}`, updatedAt)),
  ];
}
