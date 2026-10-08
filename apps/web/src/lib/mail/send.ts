import "server-only";
import nodemailer from "nodemailer";
import { serverEnv } from "@/lib/env.server";
import { buildDigest, buildInvitation, buildNotice, type NoticeKind, type NoticeMessage } from "./notices";
import { transportOptions } from "./transport";

// Envoi des avis de sécurité de l'application (ADR-0009).
//
// L'envoi est un complément : l'action qui le déclenche a déjà abouti et ne
// dépend pas de lui. Un échec est consigné sans l'adresse du destinataire, et
// n'est jamais montré comme une erreur de l'action.

const TIMEOUT_MS = 5000;

async function send(
  to: string | null | undefined,
  message: NoticeMessage,
  label: string,
  headers?: Record<string, string>,
): Promise<boolean> {
  const env = serverEnv();
  if (!to || !env.SMTP_URL || !env.MAIL_FROM) return false;

  try {
    const transport = nodemailer.createTransport({
      ...transportOptions(env.SMTP_URL),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    // Une adresse, et une seule : elle n'est pas lue comme une liste.
    await transport.sendMail({
      from: `EduScholar <${env.MAIL_FROM}>`,
      to: { name: "", address: to },
      ...message,
      headers,
    });
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

/**
 * Envoie le courriel des notifications. Les liens de désabonnement portent un
 * jeton : ils ne sont consignés nulle part, pas même en cas d'échec.
 */
export function sendNotificationDigest(
  to: string,
  unsubscribeFr: string,
  unsubscribeEn: string,
): Promise<boolean> {
  return send(to, buildDigest(unsubscribeFr, unsubscribeEn), "Courriel des notifications", {
    "List-Unsubscribe": `<${unsubscribeFr}>`,
  });
}
