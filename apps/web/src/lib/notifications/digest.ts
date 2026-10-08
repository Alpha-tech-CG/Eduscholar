import "server-only";
import { serverEnv } from "@/lib/env.server";
import { sendNotificationDigest } from "@/lib/mail/send";
import { createServiceClient } from "@/lib/supabase/server";
import { UNSUBSCRIBE_TOKEN } from "./queries";

// Envoi du courriel des notifications, déclenché par la tâche planifiée de
// l'hébergeur. La base choisit les destinataires — ceux qui l'ont demandé, qui
// ont du nouveau et n'ont pas été prévenus depuis vingt heures — et les marque
// comme prévenus dans la même requête. Le serveur ne lit ici ni projet, ni
// notification : une adresse et un jeton de désabonnement par personne.

const BATCH = 50;

export type DigestRun = { claimed: number; sent: number };

/** `null` si la base n'a pas répondu. */
export async function sendNotificationDigests(): Promise<DigestRun | null> {
  const env = serverEnv();
  // Sans service de courriel, personne n'est marqué comme prévenu.
  if (!env.SMTP_URL || !env.MAIL_FROM) return { claimed: 0, sent: 0 };

  const { data, error } = await createServiceClient().rpc("claim_notification_digests", { p_limit: BATCH });
  if (error) return null;

  let sent = 0;
  for (const { email, unsubscribe_token: token } of data ?? []) {
    if (!UNSUBSCRIBE_TOKEN.test(token)) continue;
    const link = (locale: "fr" | "en") => new URL(`/${locale}/unsubscribe/${token}`, env.APP_URL).href;
    if (await sendNotificationDigest(email, link("fr"), link("en"))) sent += 1;
  }
  const claimed = (data ?? []).length;
  // Des nombres seulement : ni adresse, ni jeton.
  if (sent < claimed) {
    console.error(`Courriel des notifications : ${claimed - sent} envoi(s) sur ${claimed} n'ont pas abouti.`);
  }
  return { claimed, sent };
}
