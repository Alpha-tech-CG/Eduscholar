import { checkAttempt } from "@/lib/auth/rate-limit";
import { getFullySignedInUser } from "@/lib/auth/session";
import {
  LIBRARY_EXPORT_MIME,
  isLibraryExportFormat,
  libraryExportFileName,
  renderLibraryExport,
} from "@/lib/library/citation-export";
import { loadLibraryEntries } from "@/lib/library/export-loader";
import { documentLocale } from "@/lib/projects/document-loader";
import { isSameSiteRequest } from "@/lib/security/request-origin";

// Export de la bibliothèque : les favoris, ou une collection (?collection=),
// en BibTeX, RIS, CSV ou bibliographie APA. Lu sous la session de
// l'utilisateur : la collection d'autrui, une collection inexistante et une
// requête sans session donnent la même réponse.

const empty = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function GET(request: Request, context: RouteContext<"/[locale]/library/export/[format]">) {
  const { locale, format } = await context.params;
  if (!isLibraryExportFormat(format)) return empty(404);
  // Une page d'un autre site ne déclenche pas de téléchargement et ne consomme
  // pas le quota de l'utilisateur.
  if (!isSameSiteRequest(request)) return empty(404);

  const user = await getFullySignedInUser();
  if (!user) return empty(404);

  if ((await checkAttempt("export", user.id)) !== "allowed") return empty(429, { "Retry-After": "900" });

  const params = new URL(request.url).searchParams;
  const collection = params.get("collection");
  const loaded = await loadLibraryEntries(collection);
  if (loaded.status === "not_found") return empty(404);
  if (loaded.status === "failed") return empty(503);

  const body = renderLibraryExport(loaded.entries, format, documentLocale(params.get("lang"), locale));
  const base = collection === null ? "eduscholar-favoris" : `eduscholar-${loaded.name}`;
  return new Response(body, {
    headers: {
      "Content-Type": LIBRARY_EXPORT_MIME[format],
      // Nom de fichier réduit à des caractères sûrs : rien de l'utilisateur
      // n'entre tel quel dans un en-tête.
      "Content-Disposition": `attachment; filename="${libraryExportFileName(base, format)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
