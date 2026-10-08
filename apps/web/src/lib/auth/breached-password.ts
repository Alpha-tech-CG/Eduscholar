import "server-only";
import { createHash } from "node:crypto";
import { serverEnv } from "@/lib/env.server";

// Contrôle des mots de passe compromis (ADR-0011), à l'inscription et au
// changement de mot de passe.
//
// Le mot de passe ne quitte pas le serveur : seuls les cinq premiers caractères
// de son empreinte SHA-1 sont envoyés à « Have I Been Pwned », qui rend toutes
// les empreintes connues commençant ainsi (k-anonymat). La comparaison se fait
// ici. La réponse est complétée par le service pour que sa taille ne dise rien.
//
// Le contrôle est un complément : s'il est désactivé, ou si le service ne
// répond pas en deux secondes, le mot de passe est accepté. La règle de
// longueur et de composition, elle, est tenue par le service d'authentification.

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2000;

/** Le suffixe de l'empreinte figure-t-il dans la réponse du service ? */
export function isSuffixListed(body: string, suffix: string): boolean {
  return body.split(/\r?\n/).some((line) => {
    const [candidate, count] = line.trim().split(":");
    return candidate?.toUpperCase() === suffix && Number.parseInt(count ?? "0", 10) > 0;
  });
}

export function sha1Parts(password: string): { prefix: string; suffix: string } {
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

export async function isBreachedPassword(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (serverEnv().PASSWORD_BREACH_CHECK !== "1") return false;
  const { prefix, suffix } = sha1Parts(password);
  try {
    const response = await fetcher(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return false;
    return isSuffixListed(await response.text(), suffix);
  } catch {
    return false;
  }
}
