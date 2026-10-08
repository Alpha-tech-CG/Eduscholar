# Catalogue des ressources

**Mise à jour :** 6 octobre 2026 (B-13, B-14)
**Références :** cahier §6.4, §6.6, §7 ; `authorization-model.md` §5.1 ; `content-and-licensing-policy.md` ; ADR-0007

## Principes

1. **Une fiche, pas un fichier.** Le catalogue référence une ressource et renvoie vers sa
   source officielle. Aucun fichier n'est hébergé à ce stade.
2. **Rien n'est publié sans provenance.** Lien officiel, date de vérification, et au moins
   un auteur ou une institution : c'est une contrainte de la table.
3. **Gratuit ne veut pas dire libre.** Le statut d'accès et la licence sont deux champs
   distincts ; une licence inconnue reste « inconnue ».
4. **Rien n'est publié automatiquement.** Une proposition ou un import arrive « en
   attente » ; seule une décision de modération change un statut.
5. **Aucune écriture directe.** Proposer, corriger, modérer, signaler : chaque geste passe
   par une fonction nommée de la base, qui vérifie le droit, applique la règle et écrit
   l'historique et le journal d'audit.

## Cycle de vie d'une fiche

```text
proposition ─> en attente ─> en cours d'examen ─> vérifiée ─> publiée ─> suspendue
                   │  ▲              │                │           │          │
                   │  └── correction demandée         │           └──────────┴─> retirée
                   └──────────────────────────────────┴─> refusée
```

| Action | Depuis | Vers | Motif obligatoire |
|---|---|---|---|
| Prendre en charge | en attente | en cours d'examen | non |
| Demander une correction | en attente, en cours d'examen | correction demandée | oui |
| Vérifier | en cours d'examen | vérifiée | non |
| Publier | vérifiée | publiée | non |
| Refuser | en attente, en cours d'examen, correction demandée, vérifiée | refusée | oui |
| Suspendre | publiée | suspendue | oui |
| Rétablir | suspendue | publiée | non |
| Retirer | vérifiée, publiée, suspendue | retirée | oui |

- Une fiche ne se publie jamais sans avoir été vérifiée.
- Une fiche ne se vérifie qu'après avoir été prise en charge : dès cet instant, le
  contributeur ne peut plus la modifier, et ce qui est vérifié est ce qui a été lu.
- Vérifier exige un statut d'accès connu (`access_status_required`) et, pour un contenu
  diffusé sur autorisation, une preuve conservée (`permission_proof_required`).
- Un DOI n'est unique que parmi les fiches vérifiées, publiées ou suspendues : une
  proposition ne peut pas réserver le DOI d'autrui. Le doublon est refusé à la
  vérification (`duplicate_doi`).
- Titre et textes refusent les caractères de format Unicode (inversion du sens
  d'écriture, caractères invisibles) ; une adresse contenant `@` avant l'hôte est refusée.
- Le motif est communiqué au contributeur ; l'auteur de la décision ne l'est pas.
- Une fiche suspendue ou retirée cesse aussitôt d'être visible des utilisateurs.
- Modifier le lien, la licence ou le statut d'accès d'une fiche vérifiée ou publiée la
  renvoie en attente.
- **Séparation des tâches** : un modérateur ne traite pas sa propre proposition, n'en
  lit pas les données internes, et ne lit ni ne clôt les signalements qui la visent.

Deux statuts s'ajoutent à ceux du cahier §6.4 : « correction demandée », prévue par le
pipeline du §6.6, et « retirée », que le cahier range parmi les statuts d'accès.

## Qui voit quoi

| Donnée | Utilisateur | Contributeur | Modérateur |
|---|---|---|---|
| Fiche publiée | oui | oui | oui |
| Sa propre proposition, à tout statut | — | oui | oui |
| Proposition d'un autre, non publiée | non | non | oui |
| Motif d'une décision | — | sur ses propositions | oui |
| Identité du contributeur | non | — | non (journal d'audit seulement) |
| Auteur d'une décision | non | non | non (journal d'audit seulement) |
| Notes de modération, preuve d'autorisation | non | non | oui |
| Signalement | le sien | le sien | tous |
| Identité du signaleur | non | non | non |

Un visiteur anonyme ne lit pas le catalogue par l'API. La recherche publique (B-16) sera
servie par le serveur.

L'identité du contributeur et celle du signaleur sont des colonnes sans droit de lecture.
PostgreSQL refusant une politique qui référence une telle colonne, les politiques passent
par des fonctions d'appui (`private.my_submission_ids`, `private.my_report_ids`).

## Fonctions exposées

| Fonction | Appelant | Effet |
|---|---|---|
| `submit_resource(payload)` | Compte actif au profil complété | Crée une fiche en attente ; statut, visibilité, provenance et contributeur sont fixés par la base |
| `update_submission(id, payload)` | Le contributeur | Corrige sa proposition en attente ou à corriger ; elle revient en attente |
| `withdraw_submission(id)` | Le contributeur | Retire sa proposition non publiée |
| `my_submission_ids()` | Compte connecté | Identifiants de ses propres propositions |
| `moderate_resource(id, action, motif)` | Modérateur, second facteur vérifié | Applique une transition |
| `moderator_update_resource(id, payload)` | Modérateur | Corrige une fiche ; notes internes |
| `report_resource(id, motif, détails)` | Compte actif au profil complété | Signale une fiche publiée |
| `resolve_report(id, statut, note)` | Modérateur | Traite un signalement |
| `import_connector_resource(acteur, fiche)` | Rôle serveur seulement, au nom d'un modérateur | Crée une fiche « en attente » venue d'une source autorisée |

Limites imposées en base : dix propositions et vingt signalements par jour et par compte,
un seul signalement ouvert par personne et par fiche.

Une fonction qui refuse lève une exception dont le message est un code (`forbidden`,
`not_found`, `invalid_transition`, `own_submission`, `reason_required`, `rate_limited`…),
que l'application traduit. « Introuvable » et « pas à vous » donnent la même réponse.

## Import par connecteur

Le rôle serveur peut créer et mettre à jour des fiches, jamais les supprimer. Un
déclencheur lui interdit tout statut autre que « en attente » à la création, et tout
changement de statut ensuite. L'unicité `(source, identifiant dans la source)` rend
l'import rejouable ; l'unicité du DOI parmi les fiches validées évite les doublons.

### Import par DOI (Crossref)

Un modérateur saisit un DOI sur `/moderation/import`, choisit la filière et, au besoin,
la langue. Le déroulement :

1. le serveur vérifie, sous la session de l'appelant, le rôle et le second facteur ;
2. il interroge `https://api.crossref.org/works/{doi}` : hôte fixe, DOI validé et
   encodé, aucune redirection suivie, 8 secondes et 1 Mo au plus ;
3. il normalise la réponse (`lib/connectors/crossref-normalize.ts`) ;
4. il appelle `import_connector_resource(acteur, fiche)` avec le rôle serveur. La
   fonction revérifie que l'acteur est un `moderator` non suspendu dont le second facteur
   précède le rôle, crée la fiche « en attente », écrit l'historique et le journal d'audit.

Le navigateur ne fournit jamais les métadonnées : la provenance enregistrée
(`crossref`, DOI, date de récupération) est donc vraie. La fonction n'est exécutable que
par le rôle serveur.

| Champ | Règle |
|---|---|
| Titre, auteurs, année | Repris tels quels ; balises et caractères invisibles retirés |
| Type | `journal-article`, `proceedings-article` → article ; livres → livre ; `dissertation` → thèse ; tout autre type est refusé |
| Langue | Celle de la source si le référentiel la connaît, sinon celle choisie par le modérateur |
| Licence | Reprise seulement si la source déclare, pour la version publiée (`vor`) et sans embargo en cours, une unique licence Creative Commons 4.0 ou CC0 ; sinon « inconnue » |
| Statut d'accès | Toujours « inconnu » : le modérateur le renseigne avant de vérifier |
| Lien officiel | `https://doi.org/{doi}` |
| Résumé | Jamais repris : il peut être protégé |

Un DOI déjà importé, ou déjà porté par une fiche validée, renvoie à la fiche existante,
sans nouvelle requête à la source. Une fiche refusée ou retirée n'empêche pas un nouvel
import.

**Modifications après import** : la base retient, par déclencheur, quels champs repris de
la source (titre, auteurs, année, type, langue, licence, lien officiel) ont été modifiés
depuis l'import ; la fiche les affiche sous « Modifié depuis l'import ». La liste ne
s'écrit ni ne se vide, et ne garde pas la valeur d'origine : un champ signalé le reste,
même ramené à sa valeur première. Renseigner ce qui ne vient pas de la source — statut
d'accès, niveaux, matières, mots-clés, résumé — n'est pas signalé. Les fiches importées
avant cette règle partent d'une liste vide.

**Second regard** : le modérateur qui a importé une fiche peut la prendre en charge, la
corriger ou la refuser, mais ni la vérifier ni la publier. Un autre modérateur le fait.
Limites : 60 essais par quart d'heure et par modérateur côté application, 200 imports
par jour et par modérateur en base. Une réponse `429` ou une panne de la source
n'entraîne aucune nouvelle tentative automatique ; la source est mise en pause pour la
durée qu'indique l'en-tête `Retry-After`.

## Recherche et fiche publiée

La recherche (`/search`) et la fiche (`/resources/[id]`) sont réservées aux comptes
connectés au profil complété. La recherche sans compte est reportée : elle demande un
cache côté serveur et une limitation de débit devant l'API (dette D-15).

- **Index** : la colonne `search_vector` est tenue par un déclencheur — titre (poids A),
  auteurs, mots-clés et institution (B), résumé (C), sans accents ni analyse
  linguistique. La ponctuation qui soude des mots (trait d'union, point, barre,
  apostrophe) est remplacée par des espaces, pour que l'index découpe comme la requête :
  « feu » trouve « pare-feu ». Une valeur fournie est écrasée.
- **Requête** : l'application ne garde des mots saisis que lettres et chiffres, huit mots
  au plus ; tous sont exigés. À partir de trois lettres, un mot est cherché par son début
  (`arbre` trouve `arbres`). Aucun opérateur ne peut y être glissé : la base revérifie
  les mots et les cite un par un.
- **Filtres** : type, langue, statut d'accès, niveau, matière. Une valeur absente du
  référentiel est ignorée.
- **Lecture** (ADR-0010) : la fonction `search_resources` rend les identifiants des
  fiches publiées et publiques de la page demandée, classés par pertinence puis par date
  de publication ; l'application lit ensuite leur contenu sous la session de
  l'utilisateur, où la RLS décide. Un modérateur ou un contributeur n'y voit pas de fiche
  en attente. Résultats par 20 ; le décompte s'arrête à cinq mille et le dit.
- **Fiche** : origine, licence, statut d'accès, date de dernière vérification, lien
  officiel (`rel="noopener noreferrer nofollow"`). Une fiche non publiée, réservée ou
  inexistante répond « introuvable » de la même façon.
- **Signalement** : depuis la fiche, par `report_resource`. L'identité du signaleur n'est
  lisible de personne.
- **Débit** : 150 recherches par cinq minutes et par compte dans l'application, 200 dans
  la base pour un appel direct. Pas de limite par adresse : un seul compte bloquerait
  tout un campus placé derrière la même adresse.

Limites connues :

- Le classement par pertinence est sommaire : un mot du titre pèse plus qu'un mot du
  résumé. Au-delà de cinq mille fiches trouvées, il porte sur cinq mille d'entre elles.
- La file de modération cherche sous RLS, sans index : elle est courte.
- Les mots cherchés figurent dans l'adresse de la page (historique du navigateur,
  journaux d'accès de l'hébergeur). Ils ne partent pas vers les sites externes.
- Hors écritures latine, grecque et cyrillique, le retrait des signes diacritiques peut
  différer entre l'application et l'index.

## Bibliothèque personnelle

Favoris (`resource_favorites`) et collections (`collections`, `collection_items`) sont
privés : lisibles de leur seul titulaire, ni de la modération, ni de l'administration, ni
du rôle serveur. Rien n'en est écrit au journal d'audit.

- **Lecture** par RLS ; **écriture** par fonctions seulement (`set_favorite`,
  `create_collection`, `update_collection`, `delete_collection`, `set_collection_item`).
- Seule une fiche publiée et publique se garde. Une fiche cachée et une fiche inexistante
  donnent la même réponse, tout comme la collection d'autrui et une collection inexistante.
- Une fiche suspendue ou retirée reste rangée mais n'est plus lisible : l'écran indique
  « plus disponible », sans son titre, et elle peut toujours être enlevée.
- Plafonds : 2 000 favoris, 50 collections, 500 ressources par collection.
- Nom de collection : 120 caractères, unique par titulaire sans égard à la casse ni à la
  forme Unicode, sans caractère invisible. Description : 1 000 caractères.
- La suppression du compte efface favoris et collections.

## Écrans

| Page | Pour qui |
|---|---|
| `/contribute` | Proposer une ressource |
| `/contributions`, `/contributions/[id]` | Suivre, corriger ou retirer ses propositions |
| `/moderation`, `/moderation/[id]` | File d'attente (par pages de 20, les plus anciennes d'abord, filtrable par mots), signalements, décision et correction |
| `/moderation/import` | Importer une fiche par son DOI (modérateurs) |
| `/search` | Rechercher parmi les fiches publiées |
| `/library`, `/library/collections/[id]` | Favoris et collections privées |
| `/resources/[id]` | Fiche publiée et signalement |

Les pages de modération répondent « introuvable » à qui n'est pas modérateur. Ce n'est
qu'un aiguillage : chaque lecture passe par la RLS, chaque décision par la base.

## Désigner un modérateur

Par l'écran d'administration (`/admin`), réservé aux administrateurs : voir
[`docs/security/administration.md`](../security/administration.md). La personne doit avoir
activé la validation en deux étapes avant de recevoir le rôle.

## Non couvert

- Recherche et page publique d'une ressource : B-16.
- Signalement depuis la page d'une ressource : avec B-16.
- Demande de retrait par une personne sans compte : Phase 2.
- Catalogue institutionnel (fiches réservées à une organisation) : les règles de lecture
  existent, pas les fonctions d'écriture.
- Hébergement de fichiers : Phase 2.
- Score de qualité : avec la recherche.
