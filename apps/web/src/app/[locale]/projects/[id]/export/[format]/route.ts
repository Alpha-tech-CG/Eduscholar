import { checkAttempt } from "@/lib/auth/rate-limit";
import { getFullySignedInUser } from "@/lib/auth/session";
import { documentLocale, loadDocument } from "@/lib/projects/document-loader";
import { exportFileName, toMarkdown } from "@/lib/projects/document";
import { DOCX_MIME, toDocx } from "@/lib/projects/docx";
import { isSameSiteRequest } from "@/lib/security/request-origin";

// Téléchargement du mémoire au format DOCX ou Markdown. Le document est lu sous
// la session de l'utilisateur : le projet d'autrui, un projet inexistant et une
// requête sans session donnent la même réponse.

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  request: Request,
  context: RouteContext<"/[locale]/projects/[id]/export/[format]">,
) {
  const { locale, id, format } = await context.params;
  if (format !== "docx" && format !== "md") return notFound();
  // Une page d'un autre site ne déclenche pas de téléchargement et ne consomme
  // pas le quota de l'utilisateur.
  if (!isSameSiteRequest(request)) return notFound();

  const user = await getFullySignedInUser();
  if (!user) return notFound();

  if ((await checkAttempt("export", user.id)) !== "allowed") {
    return new Response(null, {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": "900" },
    });
  }

  const requested = new URL(request.url).searchParams.get("lang");
  const loaded = await loadDocument(id, documentLocale(requested, locale));
  if (loaded.status === "not_found") return notFound();
  if (loaded.status === "failed") {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (loaded.status === "too_large") {
    return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  const fileName = exportFileName(loaded.project.title, format);
  const headers = {
    // Nom de fichier réduit à des caractères sûrs : rien de l'utilisateur
    // n'entre tel quel dans un en-tête.
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (format === "md") {
    return new Response(toMarkdown(loaded.document), {
      headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
  return new Response(new Uint8Array(await toDocx(loaded.document)), {
    headers: { ...headers, "Content-Type": DOCX_MIME },
  });
}
