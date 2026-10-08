import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { offlinePageCsp, renderOfflinePage } from "@/lib/offline/offline-page";

// Page hors ligne (ADR-0012) : produite une fois, au build, à partir des
// catalogues de messages. Elle ne lit ni cookie ni session ; le proxy ne s'y
// applique pas. Le service worker la garde et la sert quand le réseau manque.
export const dynamic = "force-static";

const catalogues = { fr, en } as const;

export function GET(): Response {
  const html = renderOfflinePage(
    Object.entries(catalogues).map(([locale, messages]) => ({ locale, ...messages.Offline })),
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
