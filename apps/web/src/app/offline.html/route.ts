import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import pt from "../../../messages/pt.json";
import { locales, type Locale } from "@/i18n/routing";
import { offlinePageCsp, renderOfflinePage } from "@/lib/offline/offline-page";

// Page hors ligne (ADR-0012) : produite une fois, au build, à partir des
// catalogues de messages. Elle ne lit ni cookie ni session ; le proxy ne s'y
// applique pas. Le service worker la garde et la sert quand le réseau manque.
export const dynamic = "force-static";

// Un catalogue par langue de l'interface : le type exige qu'aucune ne manque.
const catalogues: Record<Locale, { Offline: typeof fr.Offline }> = { fr, en, pt };

export function GET(): Response {
  const html = renderOfflinePage(
    locales.map((locale) => ({ locale, ...catalogues[locale].Offline })),
  );
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": offlinePageCsp(),
      // Identique pour tous : le navigateur peut la garder, mais la revalide.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
