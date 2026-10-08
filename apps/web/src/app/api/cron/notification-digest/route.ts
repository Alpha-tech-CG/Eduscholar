import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env.server";
import { sendNotificationDigests } from "@/lib/notifications/digest";

// Déclenche l'envoi du courriel des notifications. Appelée par la tâche
// planifiée de l'hébergeur, qui présente CRON_SECRET ; pour tout autre appel,
// et tant que le secret n'est pas défini, la route n'existe pas.
//
// La réponse ne porte que deux nombres : aucune adresse, aucun jeton.

export const dynamic = "force-dynamic";

const digest = (value: string) => createHash("sha256").update(value).digest();

export async function GET(request: Request): Promise<Response> {
  const secret = serverEnv().CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const run = await sendNotificationDigests();
  return Response.json(run ? { status: "ok", ...run } : { status: "unavailable" }, {
    status: run ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
