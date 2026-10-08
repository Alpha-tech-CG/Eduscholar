import type { MetadataRoute } from "next";
import messages from "../../messages/fr.json";
import { THEME } from "@/lib/offline/service-worker";

// Manifeste de l'application installable (ADR-0012). Il est unique : une seule
// adresse, donc une seule langue, celle par défaut. L'adresse de départ est la
// racine, que le proxy redirige vers la langue du navigateur.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: messages.Metadata.title,
    short_name: messages.Metadata.title,
    description: messages.Metadata.description,
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME.light,
    theme_color: THEME.light,
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
