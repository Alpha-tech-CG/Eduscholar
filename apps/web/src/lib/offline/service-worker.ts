/**
 * Service worker (ADR-0012). Son code est dans `public/sw.js`.
 *
 * Chemin de retrait : passer cette valeur à « false » ; chaque page ouverte
 * désinscrit alors le worker et supprime ses caches. En cas d'urgence (une page
 * qui ne se charge plus), passer aussi `RETIRED` à « true » dans `public/sw.js`.
 */
export const SERVICE_WORKER_ENABLED = true;

export const SERVICE_WORKER_URL = "/sw.js";
export const OFFLINE_PAGE_URL = "/offline.html";
/** Préfixe des caches du worker : rien d'autre n'est supprimé au retrait. */
export const CACHE_PREFIX = "eduscholar-";

/** Couleurs de l'application, reprises par le manifeste et la barre du navigateur. */
export const THEME = { light: "#ffffff", dark: "#0a0a0a", ink: "#171717" } as const;
