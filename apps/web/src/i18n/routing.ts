import { defineRouting } from "next-intl/routing";

// Langues de l'interface (ADR-0005, cahier §14.1). C'est la seule liste : le
// routage, le sélecteur, la page hors ligne, les tests et le nettoyage des
// adresses de retour en dérivent. Ajouter une langue, c'est l'ajouter ici,
// écrire `messages/<code>.json` et le contenu d'aide `content/help/<code>.ts`.
export const locales = ["fr", "en", "pt"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Langues que la base admet comme préférence enregistrée dans le profil : la
 * contrainte de `profiles.preferred_locale` et `languages.is_interface`
 * doivent lister les mêmes. Une langue ajoutée ici sans migration s'afficherait
 * mais ne s'enregistrerait pas : la liste resterait alors plus courte.
 */
export const preferenceLocales = locales;
export type PreferenceLocale = (typeof preferenceLocales)[number];

export function isPreferenceLocale(value: unknown): value is PreferenceLocale {
  return typeof value === "string" && (preferenceLocales as readonly string[]).includes(value);
}

/**
 * Ordre de repli d'un libellé de référentiel : la langue demandée, puis
 * l'anglais, puis le français. Les référentiels ne sont aujourd'hui rédigés
 * qu'en français et en anglais : une interface en portugais lit l'anglais.
 */
export function labelFallbacks(locale: string): string[] {
  return [...new Set([locale, "en", defaultLocale])];
}

/** Préfixe de langue en tête d'un chemin (`/fr`, `/en/…`). */
export const LOCALE_PREFIX = new RegExp(`^/(${locales.join("|")})(?=/|$)`);

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  // L'en-tête `Link` généré par défaut reprend l'hôte annoncé par la requête.
  // Les liens alternatifs seront produits à partir de l'adresse configurée.
  alternateLinks: false,
});
