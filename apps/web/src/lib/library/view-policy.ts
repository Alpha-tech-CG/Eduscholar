// Quand une ouverture de fiche compte comme une consultation (historique
// personnel). Module pur, testé.
//
// - Un préchargement n'est pas une consultation : le navigateur l'annonce par
//   `Sec-Purpose` (ou l'ancien `Purpose`) contenant « prefetch ». Le routeur de
//   Next ne précharge pas le rendu complet d'une page dynamique par défaut ;
//   aucun lien vers /resources/[id] ne doit donc porter `prefetch={true}`, sans
//   quoi un survol de la liste de résultats remplirait l'historique.
// - Une navigation déclenchée par un autre site n'est pas enregistrée
//   (décision de l'orchestrateur, revue du lot 7) : une page tierce ne doit pas
//   pouvoir écrire dans l'historique d'une personne connectée. Seules comptent
//   `Sec-Fetch-Site: same-origin` et `none` (adresse saisie, favori du
//   navigateur) ; sans cet en-tête (navigateur ancien, outil), la consultation
//   est enregistrée.

export function shouldRecordView(headers: Pick<Headers, "get">): boolean {
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch")) return false;
  const site = headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
