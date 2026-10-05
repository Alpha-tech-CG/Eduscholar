import createIntlMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import {
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/security/headers";

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * Le proxy ne fait que deux choses : le routage par langue et la CSP.
 * Il ne porte aucune autorisation (modèle de menaces M-53) : chaque
 * Route Handler et chaque Server Action contrôle l'accès lui-même.
 */
export default function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );

  // Next.js lit le nonce dans l'en-tête CSP de la requête pour l'appliquer
  // à ses propres scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = handleI18nRouting(
    new NextRequest(request, { headers: requestHeaders }),
  );
  response.headers.set("Content-Security-Policy", csp);

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
