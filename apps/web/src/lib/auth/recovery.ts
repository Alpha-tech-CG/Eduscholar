/** Durée pendant laquelle une session ouverte par un lien de réinitialisation permet de choisir un mot de passe. */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

export type AuthenticationMethod = { method?: unknown; timestamp?: unknown };

/**
 * Vrai si la plus récente méthode d'authentification de la session est un lien
 * reçu par courriel, utilisé il y a moins d'un quart d'heure.
 *
 * La liste vient de la revendication `amr` du jeton, signée par le service
 * d'authentification.
 */
export function isRecoveryMethodList(methods: unknown, now: number): boolean {
  if (!Array.isArray(methods)) return false;

  const latest = (methods as AuthenticationMethod[])
    .filter(
      (entry): entry is { method: string; timestamp: number } =>
        typeof entry?.method === "string" && typeof entry?.timestamp === "number",
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!latest) return false;

  const ageSeconds = now / 1000 - latest.timestamp;
  return latest.method === "otp" && ageSeconds >= -60 && ageSeconds <= RECOVERY_WINDOW_SECONDS;
}
