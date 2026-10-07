// Options de connexion au serveur d'envoi, tirées de SMTP_URL.
//
// Le chiffrement est obligatoire : `smtps://` chiffre d'emblée ; `smtp://`
// exige STARTTLS et refuse de continuer en clair si le serveur ne l'offre pas —
// sans quoi un tiers placé sur le chemin pourrait lire l'identifiant, le secret
// et l'adresse du destinataire. Seule la boîte locale de développement, sur la
// machine même, est jointe sans chiffrement.

export type TransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function transportOptions(smtpUrl: string): TransportOptions {
  const server = new URL(smtpUrl);
  const secure = server.protocol === "smtps:";
  return {
    host: server.hostname,
    port: Number(server.port) || (secure ? 465 : 587),
    secure,
    requireTLS: !secure && !LOCAL_HOSTS.has(server.hostname),
    ...(server.username
      ? { auth: { user: decodeURIComponent(server.username), pass: decodeURIComponent(server.password) } }
      : {}),
  };
}
