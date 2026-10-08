"use client";

import { useEffect } from "react";
import {
  CACHE_PREFIX,
  SERVICE_WORKER_ENABLED,
  SERVICE_WORKER_URL,
} from "@/lib/offline/service-worker";

// Inscription du service worker (ADR-0012), ou son retrait. En développement il
// n'est jamais inscrit : les fichiers du build n'y portent pas d'empreinte.

async function register(): Promise<void> {
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
    // Le fichier du worker n'est jamais pris dans le cache HTTP.
    updateViaCache: "none",
  });
}

/** Désinscrit le worker et supprime ses caches : il ne reste rien de lui. */
async function retire(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
  );
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const wanted = SERVICE_WORKER_ENABLED && process.env.NODE_ENV === "production";
    // Un échec ne change rien pour l'utilisateur : l'application fonctionne sans worker.
    const run = () => void (wanted ? register() : retire()).catch(() => undefined);

    // Après le chargement : le worker ne dispute pas le réseau à la page.
    if (document.readyState === "complete") {
      run();
      return;
    }
    window.addEventListener("load", run, { once: true });
    return () => window.removeEventListener("load", run);
  }, []);

  return null;
}
