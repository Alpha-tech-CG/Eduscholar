// Délai demandé par une source qui répond « trop de requêtes ».
//
// L'en-tête Retry-After porte un nombre de secondes ou une date HTTP. Le délai
// retenu est borné : une minute au moins, une heure au plus. Sans en-tête
// lisible, cinq minutes.

export const DEFAULT_PAUSE_SECONDS = 300;
const MIN_PAUSE_SECONDS = 60;
const MAX_PAUSE_SECONDS = 3600;

export function pauseSeconds(retryAfter: string | null, now: number = Date.now()): number {
  const value = (retryAfter ?? "").trim();
  let seconds = DEFAULT_PAUSE_SECONDS;

  if (/^\d{1,9}$/.test(value)) {
    seconds = Number(value);
  } else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) seconds = Math.ceil((date - now) / 1000);
  }

  return Math.min(Math.max(seconds, MIN_PAUSE_SECONDS), MAX_PAUSE_SECONDS);
}
