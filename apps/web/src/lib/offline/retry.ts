/**
 * Reprise d'un enregistrement refusé faute de réseau (ADR-0012) : le délai
 * double à chaque échec, jusqu'à un plafond. Une part d'aléa évite que tous les
 * onglets ouverts reviennent au même instant après une panne.
 */

export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 60_000;
/** Part du délai tirée au hasard, en plus ou en moins. */
const JITTER = 0.2;

/**
 * Délai avant le prochain essai. `failures` compte les échecs consécutifs, à
 * partir de un ; `random` rend un nombre de [0, 1[.
 */
export function retryDelay(failures: number, random: () => number = Math.random): number {
  const step = Number.isFinite(failures) ? Math.max(1, Math.floor(failures)) : 1;
  // Au-delà de vingt doublements, le plafond est atteint depuis longtemps.
  const raw = RETRY_BASE_MS * 2 ** Math.min(step - 1, 20);
  const capped = Math.min(raw, RETRY_MAX_MS);
  const spread = 1 + (random() * 2 - 1) * JITTER;
  return Math.min(Math.round(capped * spread), RETRY_MAX_MS);
}
