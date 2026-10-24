import path from "node:path";
import type { NextConfig } from "next";
import {
  apiContentSecurityPolicy,
  serviceWorkerHeaders,
  staticSecurityHeaders,
} from "./src/lib/security/headers";
import { assertLegalEntityComplete } from "./src/content/legal/check";
import { LEGAL_ENTITY } from "./src/content/legal/entity";

// Pages juridiques : la production Vercel ne se construit pas tant qu'une
// information de l'entité responsable manque (src/content/legal/entity.ts).
assertLegalEntityComplete(process.env, LEGAL_ENTITY);

// next-intl lit sa configuration de requête par l'alias `next-intl/config`.
// Son plugin officiel (`next-intl/plugin`) pose cet alias, mais il charge
// aussi `@swc/core`, dont le module natif refuse de s'installer sur certains
// postes Windows (contrôle des permissions de son dossier de cache). L'alias
// est donc posé ici directement ; c'est tout ce que fait le plugin pour notre
// usage. Les tests de bout en bout échouent si cet alias cesse de fonctionner.
// Voir docs/architecture/adr-0008-outillage-socle.md.
const requestConfig = "./src/i18n/request.ts";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Fixé explicitement : l'import de références admet un fichier d'un
      // mégaoctet (IMPORT_MAX_BYTES), refusé au-delà par l'application avec un
      // message clair ; la marge couvre l'enveloppe multipart. Toute autre
      // action borne ses champs bien en deçà.
      bodySizeLimit: "1.2mb",
    },
  },
  turbopack: {
    resolveAlias: {
      "next-intl/config": requestConfig,
    },
  },
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["next-intl/config"] = path.resolve(
      config.context,
      requestConfig,
    );
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...staticSecurityHeaders],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Content-Security-Policy", value: apiContentSecurityPolicy },
        ],
      },
      {
        source: "/sw.js",
        headers: [...serviceWorkerHeaders],
      },
    ];
  },
};

export default nextConfig;
