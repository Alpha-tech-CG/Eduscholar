// Constantes du défi anti-robot partagées par le serveur, le proxy et le
// widget : une seule définition, pour que le widget ne s'affiche jamais sous
// une politique de sécurité de contenu qui le refuserait.

/** Champ rempli par le widget dans le formulaire. */
export const CAPTCHA_FIELD = "captchaToken";

/** Forme d'une clé de site Cloudflare Turnstile. */
export const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{10,100}$/;

/** Le défi est-il configuré ? Même décision partout. */
export function isCaptchaConfigured(siteKey: string | undefined): boolean {
  return SITE_KEY_PATTERN.test(siteKey ?? "");
}
