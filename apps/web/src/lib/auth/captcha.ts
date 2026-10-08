import "server-only";
import { serverEnv } from "@/lib/env.server";

// Défi anti-robot (Cloudflare Turnstile, ADR-0011).
//
// L'application ne vérifie pas le jeton elle-même : elle le transmet au
// service d'authentification, qui le vérifie auprès de Cloudflare. C'est lui la
// barrière, parce qu'il est joignable sans passer par l'application ; un jeton
// ne sert qu'une fois, et le vérifier ici le rendrait inutilisable pour lui.

/** Champ rempli par le widget dans le formulaire. */
export const CAPTCHA_FIELD = "captchaToken";

/** Clé de site, ou `null` si le défi n'est pas configuré. */
export function captchaSiteKey(): string | null {
  return serverEnv().TURNSTILE_SITE_KEY ?? null;
}

export type CaptchaInput = {
  /** Jeton à transmettre au service d'authentification, s'il y en a un. */
  token: string | undefined;
  /** Le défi est configuré et le formulaire n'a pas apporté de jeton. */
  missing: boolean;
};

/** Lit le jeton du formulaire. Un jeton mal formé est tenu pour absent. */
export function readCaptcha(formData: FormData): CaptchaInput {
  const value = formData.get(CAPTCHA_FIELD);
  const token = typeof value === "string" && /^[\w.-]{20,2100}$/.test(value) ? value : undefined;
  return { token, missing: captchaSiteKey() !== null && token === undefined };
}
