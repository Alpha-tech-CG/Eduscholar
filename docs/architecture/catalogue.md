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

**Second regard** : le modérateur qui a importé une fiche peut la prendre en charge, la
corriger ou la refuser, mais ni la vérifier ni la publier. Un autre modérateur le fait.
Limites : 60 essais par quart d'heure et par modérateur côté application, 200 imports
par jour et par modérateur en base. Une réponse `429` ou une panne de la source
n'entraîne aucune nouvelle tentative automatique ; le respect de l'en-tête `Retry-After`
reste à faire (dette D-20).

## Écrans

| Page | Pour qui |
|---|---|
| `/contribute` | Proposer une ressource |
| `/contributions`, `/contributions/[id]` | Suivre, corriger ou retirer ses propositions |
| `/moderation`, `/moderation/[id]` | File d'attente, signalements, décision et correction |
| `/moderation/import` | Importer une fiche par son DOI (modérateurs) |

Les pages de modération répondent « introuvable » à qui n'est pas modérateur. Ce n'est
qu'un aiguillage : chaque lecture passe par la RLS, chaque décision par la base.

## Désigner un modérateur

Il n'existe pas encore d'écran d'administration (dette D-01). Un modérateur est désigné
par une personne ayant accès à la base :

1. La personne crée son compte, complète son profil et active la validation en deux
   étapes dans `/account/security`.
2. Un administrateur de la base lui attribue le rôle :

   ```sql
   insert into public.platform_roles (user_id, role)
   select id, 'moderator' from auth.users where email = 'adresse@exemple.org';
   ```

3. Elle se reconnecte et saisit son code : le lien « Modération » apparaît dans son compte.

L'attribution est journalisée. Sans second facteur vérifié dans la session, le rôle ne
donne aucun droit.

## Non couvert

- Recherche et page publique d'une ressource : B-16.
- Signalement depuis la page d'une ressource : avec B-16.
- Demande de retrait par une personne sans compte : Phase 2.
- Catalogue institutionnel (fiches réservées à une organisation) : les règles de lecture
  existent, pas les fonctions d'écriture.
- Hébergement de fichiers : Phase 2.
- Score de qualité : avec la recherche.
