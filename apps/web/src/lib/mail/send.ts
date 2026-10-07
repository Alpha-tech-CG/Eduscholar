import "server-only";
import nodemailer from "nodemailer";
import { serverEnv } from "@/lib/env.server";
import { buildNotice, type NoticeKind } from "./notices";
import { transportOptions } from "./transport";

// Envoi des avis de sécurité de l'application (ADR-0009).
//
// L'envoi est un complément : l'action qui le déclenche a déjà abouti et ne
// dépend pas de lui. Un échec est consigné sans l'adresse du destinataire, et
// n'est jamais montré comme une erreur de l'action.

const TIMEOUT_MS = 5000;

/**
 * Envoie un avis au titulaire. Rend `false` si l'envoi n'est pas configuré ou
 * s'il échoue.
 */
export async function sendAccountNotice(to: string | null | undefined, kind: NoticeKind): Promise<boolean> {
  const env = serverEnv();
  if (!to || !env.SMTP_URL || !env.MAIL_FROM) return false;

  try {
    const transport = nodemailer.createTransport({
      ...transportOptions(env.SMTP_URL),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    const { subject, text, html } = buildNotice(kind);
    await transport.sendMail({ from: `EduScholar <${env.MAIL_FROM}>`, to, subject, text, html });
    return true;
  } catch {
    console.error(`Avis « ${kind} » non envoyé : le service de courriel n'a pas accepté le message.`);
    return false;
  }
}
