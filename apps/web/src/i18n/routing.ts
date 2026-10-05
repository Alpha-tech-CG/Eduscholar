import { defineRouting } from "next-intl/routing";

export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  // L'en-tête `Link` généré par défaut reprend l'hôte annoncé par la requête.
  // Les liens alternatifs seront produits à partir de l'adresse configurée.
  alternateLinks: false,
});
