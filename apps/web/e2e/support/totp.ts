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
 * Renvoie un code qui n'a pas encore servi : un même code n'est accepté
 * qu'une fois, il faut donc parfois attendre le pas suivant.
 */
export async function freshTotp(secret: string, used: Set<string>): Promise<string> {
  for (;;) {
    const code = totp(secret);
    // Une marge évite de saisir un code qui expire pendant l'envoi.
    const remaining = 30_000 - (Date.now() % 30_000);
    if (!used.has(code) && remaining > 3_000) {
      used.add(code);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
