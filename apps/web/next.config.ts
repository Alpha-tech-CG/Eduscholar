import path from "node:path";
import type { NextConfig } from "next";
import {
  apiContentSecurityPolicy,
  serviceWorkerHeaders,
  staticSecurityHeaders,
} from "./src/lib/security/headers";

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
