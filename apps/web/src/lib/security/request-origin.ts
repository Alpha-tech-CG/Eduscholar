// Origine d'une requête, pour les gestionnaires de route.
//
// Les Server Actions sont protégées par Next ; un gestionnaire de route ne
// l'est pas. Le cookie de session (SameSite=Lax) accompagne une navigation GET
// venue d'un autre site : sans ce contrôle, une page tierce pourrait déclencher
// un téléchargement ou épuiser un quota.

/**
 * Faux si la requête est déclenchée par un autre site. Les navigateurs
 * actuels envoient `Sec-Fetch-Site` ; en son absence (outil, vieux navigateur),
 * la requête est admise : le cookie seul ne donne alors rien de plus.
 */
export function isSameSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  // « none » : adresse saisie, favori ou lien ouvert hors d'une page.
  return site === null || site === "same-origin" || site === "none";
}

/**
 * Pour une requête qui écrit ou qui exporte : l'en-tête `Origin` doit désigner
 * l'hôte auquel la requête est adressée. C'est le contrôle que Next applique à
 * ses actions serveur : un navigateur fixe lui-même ces deux en-têtes, et une
 * page tierce ne peut pas les accorder.
 */
export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Sans `Origin` : seul un navigateur qui certifie une requête de même origine est admis.
  if (origin === null) return request.headers.get("sec-fetch-site") === "same-origin";

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host.split(",")[0]?.trim();
  } catch {
    return false;
  }
}
