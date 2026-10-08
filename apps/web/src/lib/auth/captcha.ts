import "server-only";
import { serverEnv } from "@/lib/env.server";
import { CAPTCHA_FIELD } from "./captcha-shared";

// Défi anti-robot (Cloudflare Turnstile, ADR-0011).
//
// L'application ne vérifie pas le jeton elle-même : elle le transmet au
// service d'authentification, qui le vérifie auprès de Cloudflare. C'est lui la
// barrière, parce qu'il est joignable sans passer par l'application ; un jeton
// ne sert qu'une fois, et le vérifier ici le rendrait inutilisable pour lui.


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
/**
 * Le service d'authentification a-t-il refusé le défi ? Il le vérifie avant
 * tout accès au compte : ce refus ne dit rien de l'existence d'un compte.
 */
export function isCaptchaRefusal(error: { code?: string } | null | undefined): boolean {
  return error?.code === "captcha_failed";
}

export function readCaptcha(formData: FormData): CaptchaInput {
  const value = formData.get(CAPTCHA_FIELD);
  const token = typeof value === "string" && /^[\w.-]{20,2100}$/.test(value) ? value : undefined;
  return { token, missing: captchaSiteKey() !== null && token === undefined };
}
