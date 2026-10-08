import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { sendAccountNotice } from "@/lib/mail/send";
import { createServiceClient } from "@/lib/supabase/server";
import { recordAuthEvent } from "./events";

// Alerte de nouvelle connexion. Le navigateur est reconnu à un témoin
// aléatoire, illisible par les scripts ; la base n'en garde qu'une empreinte
// propre au compte : deux comptes ouverts depuis le même poste n'y sont pas
// reliés. Rien d'autre n'est relevé : ni adresse IP, ni nom d'appareil, ni lieu.
//
// L'enregistrement est fait par le serveur, sous le rôle de service, pour le
// compte dont le service d'authentification vient d'accepter le mot de passe :
// aucun utilisateur ne peut faire connaître un navigateur par lui-même.

const DEVICE_COOKIE = process.env.NODE_ENV === "production" ? "__Host-es-device" : "es-device";
const DEVICE_VALUE = /^[0-9a-f]{64}$/;
const YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * À appeler dès le mot de passe accepté, avec le compte que le service
 * d'authentification vient de rendre. Prévient le titulaire si ce navigateur
 * lui est inconnu. N'échoue jamais : la connexion a déjà abouti.
 */
export async function noteSignInDevice(user: { id: string; email?: string | null }): Promise<void> {
  try {
    const cookieStore = await cookies();
    let value = cookieStore.get(DEVICE_COOKIE)?.value ?? "";
    if (!DEVICE_VALUE.test(value)) {
      value = randomBytes(32).toString("hex");
      cookieStore.set(DEVICE_COOKIE, value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: YEAR_SECONDS,
      });
    }

    const { data, error } = await createServiceClient().rpc("register_sign_in_device", {
      p_user_id: user.id,
      p_device_hash: createHash("sha256").update(`${value}:${user.id}`).digest("hex"),
    });
    if (error) {
      // Une alerte qui n'a pas pu être décidée se voit dans les compteurs.
      await recordAuthEvent("failed:device-check");
      return;
    }
    if (data === true) {
      const email = user.email;
      // L'envoi suit la réponse : un service de courriel lent ne retarde pas la connexion.
      after(async () => {
        await recordAuthEvent("new-device:sign-in");
        await sendAccountNotice(email, "new_sign_in");
      });
    }
  } catch {
    // L'alerte est un complément : la connexion ne dépend pas d'elle.
  }
}
