/** Durée pendant laquelle une session ouverte par un lien de réinitialisation permet de choisir un mot de passe. */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

export type AuthenticationMethod = { method?: unknown; timestamp?: unknown };

/**
 * Vrai si la session a été ouverte par un lien reçu par courriel, il y a moins
 * d'un quart d'heure.
 *
 * La liste vient de la revendication `amr` du jeton, signée par le service
 * d'authentification. Une connexion par mot de passe n'y inscrit jamais la
 * méthode « otp ». Un compte à deux étapes y ajoute ensuite son code : la
 * méthode « otp » n'est alors plus la dernière, mais elle reste présente.
 */
export function isRecoveryMethodList(methods: unknown, now: number): boolean {
  if (!Array.isArray(methods)) return false;

  const entries = (methods as AuthenticationMethod[]).filter(
    (entry): entry is { method: string; timestamp: number } =>
      typeof entry?.method === "string" && typeof entry?.timestamp === "number",
  );
  // Une session ouverte par mot de passe ne devient pas une session de
  // réinitialisation, quoi qu'elle contienne par ailleurs.
  if (entries.some((entry) => entry.method === "password")) return false;

  return entries.some((entry) => {
    const ageSeconds = now / 1000 - entry.timestamp;
    return entry.method === "otp" && ageSeconds >= -60 && ageSeconds <= RECOVERY_WINDOW_SECONDS;
  });
}
