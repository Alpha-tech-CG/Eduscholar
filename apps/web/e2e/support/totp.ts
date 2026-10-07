import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";

// Calcul d'un code TOTP (RFC 6238 : SHA-1, six chiffres, pas de trente
// secondes), comme le ferait une application d'authentification.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Buffer {
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Clé de second facteur invalide");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

export function totp(secret: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));

  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;

  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * Fait comme si la dernière validation du facteur datait de deux minutes.
 *
 * La base n'accepte un second code qu'une minute à une minute et demie après
 * le précédent. Les parcours de test en saisissent plusieurs à la suite : ils
 * reculent la dernière validation au lieu d'attendre. Le délai lui-même a son
 * propre test, qui n'utilise pas cette aide.
 */
export function forgetLastSuccess(secret: string): void {
  if (!/^[A-Z2-7=]+$/i.test(secret)) throw new Error("Clé de second facteur invalide");
  execFileSync(
    "docker",
    [
      "exec", "supabase_db_eduscholar", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qc",
      `update private.second_factor_attempts a set last_success_at = a.last_success_at - interval '2 minutes'
       from auth.mfa_factors f
       where f.id = a.factor_id and f.secret = '${secret}' and a.last_success_at > now() - interval '2 minutes'`,
    ],
    { encoding: "utf8" },
  );
}

/**
 * Renvoie un code qui n'a pas encore servi : un même code n'est accepté
 * qu'une fois, il faut donc parfois attendre le pas suivant.
 *
 * `keepDelay` : ne pas effacer l'attente imposée entre deux codes.
 */
export async function freshTotp(
  secret: string,
  used: Set<string>,
  { keepDelay = false }: { keepDelay?: boolean } = {},
): Promise<string> {
  for (;;) {
    const code = totp(secret);
    // Une marge évite de saisir un code qui expire pendant l'envoi.
    const remaining = 30_000 - (Date.now() % 30_000);
    if (!used.has(code) && remaining > 3_000) {
      used.add(code);
      if (!keepDelay) forgetLastSuccess(secret);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
