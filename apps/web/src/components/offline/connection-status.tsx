"use client";

import { useSyncExternalStore } from "react";

// Bandeau « hors ligne » (ADR-0012, cahier §10.7). La zone d'état existe
// toujours, vide : un lecteur d'écran n'annonce le message qu'à son apparition,
// une seule fois, sans interrompre la lecture en cours.
//
// `navigator.onLine` dit seulement que l'appareil a une interface réseau
// active : le bandeau peut manquer une connexion inutilisable, jamais en
// inventer une. L'éditeur de section ne s'y fie pas pour enregistrer.

function subscribe(notify: () => void): () => void {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

const isOnline = () => navigator.onLine;
// Au rendu serveur, rien n'indique une coupure.
const assumeOnline = () => true;

export function ConnectionStatus({ label }: { label: string }) {
  const online = useSyncExternalStore(subscribe, isOnline, assumeOnline);

  return (
    <div
      role="status"
      data-testid="connection-status"
      className={
        online
          ? "print:hidden"
          : "sticky top-0 z-20 bg-foreground px-4 py-2 text-center text-sm text-background print:hidden"
      }
    >
      {online ? null : label}
    </div>
  );
}
