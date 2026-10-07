import "server-only";
import nodemailer from "nodemailer";
import { serverEnv } from "@/lib/env.server";
import { buildInvitation, buildNotice, type NoticeKind, type NoticeMessage } from "./notices";
import { transportOptions } from "./transport";

// Envoi des avis de sécurité de l'application (ADR-0009).
//
// L'envoi est un complément : l'action qui le déclenche a déjà abouti et ne
// dépend pas de lui. Un échec est consigné sans l'adresse du destinataire, et
// n'est jamais montré comme une erreur de l'action.

const TIMEOUT_MS = 5000;

async function send(to: string | null | undefined, message: NoticeMessage, label: string): Promise<boolean> {
  const env = serverEnv();
  if (!to || !env.SMTP_URL || !env.MAIL_FROM) return false;

  try {
    const transport = nodemailer.createTransport({
      ...transportOptions(env.SMTP_URL),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    await transport.sendMail({ from: `EduScholar <${env.MAIL_FROM}>`, to, ...message });
    return true;
  } catch {
    console.error(`${label} non envoyé : le service de courriel n'a pas accepté le message.`);
    return false;
  }
}

/**
 * Envoie un avis au titulaire. Rend `false` si l'envoi n'est pas configuré ou
 * s'il échoue.
 */
export function sendAccountNotice(to: string | null | undefined, kind: NoticeKind): Promise<boolean> {
  return send(to, buildNotice(kind), `Avis « ${kind} »`);
}

/**
 * Envoie l'invitation à suivre un projet. Le lien porte le jeton : il n'est
 * consigné nulle part, pas même en cas d'échec.
 */
export function sendProjectInvitation(
  to: string,
  link: string,
  inviterEmail: string | null,
): Promise<boolean> {
  return send(to, buildInvitation(link, inviterEmail), "Invitation");
}
