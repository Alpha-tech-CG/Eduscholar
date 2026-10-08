import { createHash } from "node:crypto";

// Valeur que le serveur de test attend de la tâche planifiée. Elle ne vaut que
// pour ce serveur, lancé par Playwright sur la machine même : ce n'est le
// secret d'aucun environnement.
export const e2eCron = {
  value: createHash("sha256").update("eduscholar:e2e:tache-planifiee").digest("hex"),
};
