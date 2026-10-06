/**
 * Adresse du client, pour la limitation de débit (modèle de menaces M-01).
 *
 * `x-forwarded-for` est contrôlé par le client tant qu'aucun proxy de confiance
 * ne l'écrase : il n'est donc jamais lu par défaut. La source dépend de
 * l'hébergement :
 *
 *  - sur Vercel, l'en-tête `x-vercel-forwarded-for`, posé par la plateforme ;
 *  - ailleurs, l'en-tête nommé par la variable `TRUSTED_CLIENT_IP_HEADER`, que
 *    le proxy frontal doit écraser ;
 *  - sans source fiable, une clé commune : la limite s'applique alors à
 *    l'ensemble des visiteurs, ce qui reste sûr mais peu fin.
 */
export const UNTRUSTED_SOURCE = "source-non-fiable";

type HeaderReader = { get(name: string): string | null };
type Environment = Record<string, string | undefined>;

export function trustedIpHeader(env: Environment = process.env): string | null {
  if (env.VERCEL) return "x-vercel-forwarded-for";
  const configured = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  return configured && /^[a-z0-9-]{1,64}$/.test(configured) ? configured : null;
}

/** Regroupe une adresse IPv6 par préfixe /64 : un abonné en dispose en entier. */
export function normalizeAddress(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (value.length === 0 || value.length > 64) return null;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value;

  if (/^[0-9a-f:.]+$/.test(value) && value.includes(":")) {
    const [head = "", tail = ""] = value.split("::");
    const headGroups = head ? head.split(":") : [];
    const tailGroups = tail ? tail.split(":") : [];
    const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
    const groups = value.includes("::")
      ? [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups]
      : headGroups;
    if (groups.length < 4) return null;
    return `${groups
      .slice(0, 4)
      .map((group) => group.replace(/^0+(?=.)/, ""))
      .join(":")}::/64`;
  }

  return null;
}

export function clientAddress(
  headers: HeaderReader,
  env: Environment = process.env,
): string {
  const header = trustedIpHeader(env);
  if (!header) return UNTRUSTED_SOURCE;

  // Le proxy de confiance ajoute l'adresse réelle en dernier.
  const last = headers.get(header)?.split(",").at(-1);
  return (last && normalizeAddress(last)) ?? UNTRUSTED_SOURCE;
}
