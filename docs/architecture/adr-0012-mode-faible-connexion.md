# ADR-0012 — Mode faible connexion : application installable, sans donnée privée hors ligne

- Statut : accepté le 8 octobre 2026 (délégation du porteur de projet)
- Contexte de la décision : Phase 5 du cahier des charges (« Mode faible connexion »,
  « Mobile ») ; cahier §10.5, §10.7, §14.3

## Contexte

Le cahier demande une application installable, des états hors ligne, une reprise après
coupure (§10.7, §14.3) et, pour le stockage local, un « cache limité et chiffré pour
données privées » effacé à la déconnexion (§10.5).

Deux contraintes déjà décidées pèsent sur la réponse :

- le navigateur n'a aucun jeton lisible : la session vit dans des cookies `HttpOnly`
  (ADR-0007). Il n'existe donc dans la page aucun secret dont dériver une clé ;
- un mémoire est privé par défaut, et l'appareil d'un étudiant est souvent partagé
  (cybercafé, téléphone familial, poste d'établissement).

Chiffrer des données privées dans le navigateur suppose une clé. Gardée dans le
navigateur, elle se lit comme les données qu'elle protège ; dérivée du mot de passe, elle
oblige à le redemander hors ligne et à le manipuler en JavaScript. Dans les deux cas le
chiffrement rassure sans protéger.

## Décision

**Aucune donnée privée n'est gardée sur l'appareil.** L'exigence « limité et chiffré »
est tenue par sa borne la plus stricte : le cache des données privées est vide. Il n'y a
rien à chiffrer, rien à effacer à la déconnexion, rien à effacer à distance.

### Application installable

- Manifeste produit par `apps/web/src/app/manifest.ts` (`/manifest.webmanifest`) : nom,
  couleurs, `start_url: "/"` (le proxy redirige vers la langue du navigateur),
  `display: standalone`, icônes SVG et PNG (192 et 512), dont deux « maskable ».
- Icônes dans `apps/web/public/icons/`, produites sans dépendance par
  `apps/web/scripts/generate-icons.mjs`.
- Le manifeste n'a qu'une adresse, donc qu'une langue : celle par défaut.

### Service worker (`apps/web/public/sw.js`)

Écrit à la main, sans bibliothèque. Sa règle : **tout ce qui n'est pas explicitement
public et immuable ne passe pas par lui.**

| Requête | Traitement | Gardée ? |
|---|---|---|
| `GET /_next/static/…` (fichiers du build, nom à empreinte) | cache, puis réseau | oui, 200 fichiers au plus |
| icônes, manifeste, `/offline.html` (liste fermée) | gardés à l'installation, demandés sans cookie | oui |
| navigation (une page) | réseau, réponse rendue telle quelle ; sans réseau, la page hors ligne (503) | **jamais** |
| données de page du routeur (`?_rsc=`), `/_next/image`, `/_next/data` | le worker ne s'en mêle pas | **jamais** |
| tout ce qui n'est pas `GET` : actions serveur, formulaires | le worker ne s'en mêle pas | **jamais** |
| `/api/…`, autres origines, adresse avec paramètres | le worker ne s'en mêle pas | **jamais** |

- Une réponse n'entre dans le cache que si elle est complète (200), de l'origine, et ne
  porte ni `private` ni `no-store`.
- La page hors ligne (`/offline.html`) est produite au build à partir des catalogues de
  messages : statique, en français et en anglais à la fois, sans script, sans donnée de
  compte. Sa politique de contenu n'admet que sa feuille de style, par son empreinte.
- Versionné (`VERSION`) : à l'activation, les caches des autres versions sont supprimés.
- **Politique de sécurité de contenu** : `worker-src 'self'` et `manifest-src 'self'`
  sont ajoutés, rien d'autre n'est élargi. Le fichier du worker est servi avec
  `default-src 'none'; connect-src 'self'` et n'est jamais mis en cache. Le proxy ne
  s'applique ni à `/sw.js` ni à `/offline.html` (deux adresses exactes) : il les aurait
  redirigés vers une langue.
- **Chemin de retrait** : passer `SERVICE_WORKER_ENABLED` à `false`
  (`apps/web/src/lib/offline/service-worker.ts`) — chaque page ouverte désinscrit alors
  le worker et supprime ses caches. En cas d'urgence, passer aussi `RETIRED` à `true`
  dans `public/sw.js` : le worker vide ses caches et se désinscrit lui-même, même si les
  pages ne se chargent plus.
- En développement, le worker n'est pas inscrit.

### À la déconnexion

Rien de privé ne subsiste, parce que rien de privé n'a été écrit : le cache du worker ne
contient que des fichiers identiques pour tous, l'application n'utilise ni
`localStorage`, ni `sessionStorage`, ni `IndexedDB`, et les pages du compte sont servies
avec `no-store`. Un test de bout en bout le vérifie : pages privées vues sous le contrôle
du worker, inventaire de tout le stockage de l'origine, déconnexion, puis demande de la
page du compte sans réseau — c'est la page hors ligne qui s'affiche.

### Indicateur de connexion

Un bandeau `role="status"` apparaît quand le navigateur se dit hors ligne et disparaît au
retour du réseau, sans animation. Il s'appuie sur `navigator.onLine`, qui peut manquer
une connexion inutilisable mais n'en invente pas : l'éditeur ne s'y fie pas pour
enregistrer.

### Reprise dans l'éditeur de section

- Le texte saisi reste **en mémoire, dans la page**. Il n'est écrit dans aucun stockage
  du navigateur.
- L'état est dit : « Non enregistré — hors ligne », « Non enregistré — serveur
  injoignable », « Enregistré à … », avec un avis unique expliquant quoi faire.
- L'envoi est retenté seul : délai doublé à chaque échec (5 s, puis 10, 20, 40), plafonné
  à 60 s, avec une part d'aléa ; et tout de suite au retour du réseau. Dix secondes au
  moins séparent toujours deux envois.
- Quitter la page avec un texte non enregistré déclenche l'avertissement du navigateur.
- **Conflit** : la règle existante ne change pas. Le serveur compare la version lue à la
  version enregistrée ; si elles diffèrent, rien n'est écrasé et l'utilisateur choisit
  entre sa version et l'autre. Une réponse perdue en route (le serveur a enregistré, la
  page ne l'a pas su) est reconnue et n'est pas présentée comme un conflit. Le serveur
  revalide chaque envoi : session, droits, schéma, version.

### Petits écrans

Vérifiés à 360 points de large par un test de bout en bout : pas de défilement horizontal
de la page, boutons, champs et liens du menu d'au moins 44 points, tableaux dans leur
propre conteneur. Corrections : hauteur minimale des boutons et des champs, coupure des
mots plus larges que l'écran (titres, adresses, DOI).

## Écarté

- **Cache de données privées, même chiffré** : voir le contexte. Sans secret hors de
  portée du JavaScript de la page, le chiffrement ne protège pas contre qui tient
  l'appareil ; et un cache de pages privées survivrait à une déconnexion faite sur un
  autre appareil.
- **Brouillon du mémoire dans `localStorage`, `sessionStorage` ou `IndexedDB`** : donnée
  privée, en clair, sur un appareil peut-être partagé, lisible par tout script de
  l'origine. Écarté tant qu'il n'existe pas de réponse à la question de la clé.
- **Synchronisation en arrière-plan (Background Sync) et file d'attente d'écritures** :
  elle suppose de garder les écritures — donc le texte — sur l'appareil, et de les
  rejouer plus tard, session peut-être fermée ou changée. Elle n'existe d'ailleurs que
  dans certains navigateurs.
- **Garder les pages publiques (accueil, connexion) pour les servir hors ligne** : leur
  en-tête dépend de la session et elles portent un nonce par requête. Le gain est faible
  face au risque de servir une page périmée.
- **Bibliothèque de service worker (Workbox, Serwist)** : une dépendance et une
  configuration de plus pour quatre règles. Le fichier écrit à la main se relit en entier.
- **`useOffline` de Next.js** : expérimental dans la version installée.

## Conséquences

- **Limite assumée : fermer l'onglet, ou le navigateur, pendant une coupure perd le
  texte qui n'a pas encore été envoyé.** L'avis à l'écran le dit, et le navigateur
  demande confirmation. Sur mobile, le système peut aussi fermer un onglet en arrière-plan
  sans rien demander.
- Hors ligne, on ne lit que la page déjà ouverte. Aucune consultation hors ligne des
  ressources ou du mémoire : les points « synchronisation différée » et « consultation
  hors ligne des ressources autorisées » du §14.3 ne sont pas couverts par cette tranche.
- Les fichiers du build sont servis depuis le cache du worker : une visite suivante sur
  un réseau lent ne les retélécharge pas.
- Un changement des règles du worker demande de changer `VERSION`.
- Deux adresses de plus échappent au proxy ; elles sont publiques et portent leur propre
  politique de contenu.

## Reste à faire

- Consultation hors ligne des ressources dont la licence l'autorise : contenu public,
  donc compatible avec cette décision, mais il faut une règle par licence et un choix
  explicite de l'utilisateur.
- Brouillon local du mémoire : à rouvrir par un nouvel ADR si une clé hors de portée de
  la page devient possible (clé non extractible liée à l'appareil, application native).
- Application mobile native.
- Budget de performance mesuré sur réseau lent et appareil modeste (poids des pages,
  temps d'interaction) : rien n'a été mesuré dans cette tranche.
- Cibles tactiles des listes de liens (page « Mon compte », pieds de page) : seuls les
  boutons, les champs et le menu ont été portés à 44 points.
- Invitation à installer sur iOS, qui ne la propose pas de lui-même.
- Inscrire les variables et écrans nouveaux dans `docs/current-state.md` et
  `docs/security/threat-model.md` (cache du navigateur, service worker).

## Relecture de sécurité du 8 octobre 2026

Aucun constat critique ou élevé. Corrigés :

- un stockage plein sur l'appareil faisait échouer le chargement des fichiers du build,
  alors que le réseau les avait fournis : l'écriture dans le cache se fait désormais après
  la réponse, et son échec est sans effet ;
- le cache n'admet ni une réponse redirigée, ni une réponse qui varie selon la session ;
- la reprise de l'enregistrement survivait au départ de la page, et pouvait partir sous la
  session d'une autre personne sur un appareil partagé : elle s'arrête quand la page est
  quittée, et le serveur n'enregistre que pour le compte qui a ouvert l'éditeur ;
- un enregistrement impossible bloquait en silence les autres formulaires de la page,
  dont la déconnexion : la personne choisit, comme pour un lien ;
- une page rendue par le cache de retour arrière du navigateur est rechargée ;
- toute réponse faite pour une session porte `Cache-Control: private, no-store`.

Risque accepté, à connaître en cas d'incident : le cache du service worker est inscriptible
par tout script de l'origine. Une faille d'injection de script pourrait y placer un faux
fichier du build, qui survivrait à la correction de la faille. La réponse à un tel incident
comprend donc le changement de `VERSION` dans `public/sw.js`, qui vide ce cache partout.

Ces corrections n'ont pas fait l'objet d'une seconde revue.
