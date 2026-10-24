import "server-only";
import type { Metadata } from "next";
import { serverEnv } from "@/lib/env.server";
import { alternateLanguages, localizedUrl } from "./public-resource";

/**
 * Adresse canonique et versions linguistiques d'une page publique, à partir de
 * l'adresse configurée (`APP_URL`), jamais de l'hôte annoncé par la requête.
 */
export function publicPageAlternates(locale: string, path: string): Metadata["alternates"] {
  const appUrl = serverEnv().APP_URL;
  return {
    canonical: localizedUrl(appUrl, locale, path),
    languages: alternateLanguages(appUrl, path),
  };
}

export function publicPageUrl(locale: string, path: string): string {
  return localizedUrl(serverEnv().APP_URL, locale, path);
}

/** Langue Open Graph : `fr_FR`, `en_GB`, `pt_PT`. */
export function openGraphLocale(locale: string): string {
  return { fr: "fr_FR", en: "en_GB", pt: "pt_PT" }[locale] ?? locale;
}
