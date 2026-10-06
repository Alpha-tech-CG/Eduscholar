import createIntlMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import {
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/security/headers";
import { refreshSession } from "@/lib/supabase/proxy";

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * Le proxy fait trois choses : rafraîchir la session, router par langue et
 * poser la CSP. Il ne porte aucune autorisation (modèle de menaces M-53) :
 * chaque page protégée, Route Handler et Server Action contrôle l'accès
 * lui-même.
 */
export default async function proxy(request: NextRequest) {
  const sessionCookies = await refreshSession(request);

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );

  // Next.js lit le nonce dans l'en-tête CSP de la requête pour l'appliquer
  // à ses propres scripts. Les en-têtes sont copiés après le rafraîchissement
  // de la session, pour transmettre les cookies à jour au rendu.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = handleI18nRouting(
    new NextRequest(request, { headers: requestHeaders }),
  );
  response.headers.set("Content-Security-Policy", csp);

  for (const { name, value, options } of sessionCookies) {
    response.cookies.set(name, value, options);
  }
  if (sessionCookies.length > 0) {
    // Une réponse qui pose une session ne doit être mise en cache nulle part (M-51).
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}

export const config = {
  matcher: [
    // Tout sauf l'API, les fichiers internes de Next.js et une liste fermée
    // d'extensions statiques. Un chemin qui contient un point ailleurs (un DOI
    // par exemple) passe bien par le proxy et reçoit la CSP. Les requêtes de
    // préchargement ne sont pas exclues : l'en-tête qui les signale est choisi
    // par le client.
    "/((?!api(?:/|$)|_next(?:/|$)|_vercel(?:/|$)|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
