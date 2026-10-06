# Modèle d'autorisation et modèle multi-tenant

**Date :** 6 octobre 2026
**Statut :** accepté (validé par le porteur de projet le 6 octobre 2026, y compris les positions par défaut de la section 9)
**Version :** 2, après revue de l'agent sécurité (5 constats HIGH, 8 MEDIUM, 2 LOW, tous intégrés)
**Tâche :** B-03
**Références :** cahier §4, §6.11, §11.2, §11.3, §12.3 ; ADR-0001, ADR-0003, ADR-0004, ADR-0007

Ce document fixe qui peut faire quoi. Toute politique RLS, tout endpoint et toute
Server Action doivent pouvoir être rattachés à une ligne de ce document. Ce qui n'y est
pas écrit est interdit.

## 1. Principes

1. **Refus par défaut.** Une table sans politique est inaccessible. Aucune politique
   `using (true)` sur une donnée privée.
2. **Trois périmètres indépendants.** Un rôle de plateforme, un rôle d'organisation et un
   rôle de projet ne se déduisent jamais l'un de l'autre.
3. **Le contenu privé appartient à son auteur.** Aucun rôle d'administration, de
   modération ou d'organisation ne donne accès à un projet de recherche, à une note ou à
   une collection privée.
4. **Le partage est explicite.** Un tiers n'accède à un projet que par une ligne dans
   `research_project_members`. Cette ligne naît d'une invitation émise par le propriétaire
   puis acceptée par l'invité, au moyen d'une fonction nommée (section 7.5). Personne ne
   l'insère directement.
5. **L'identité vient de la session.** L'identifiant de l'utilisateur est `auth.uid()`,
   jamais une valeur transmise par le client.
6. **La base est la dernière barrière, et elle doit suffire.** L'API Supabase est
   joignable sans passer par l'application. Toute règle de sécurité est donc imposée en
   base ; le code serveur la répète pour donner de bons messages d'erreur, il ne la porte
   pas seul (section 7.1).
7. **Toute élévation est tracée.** Changement de rôle, partage, modération, émission d'une
   URL de fichier : une ligne dans `audit_logs`, écrite par la base.

## 2. Les trois périmètres

### 2.1 Plateforme

| Rôle | Portée |
|---|---|
| `anon` | Visiteur non connecté |
| `user` | Tout compte authentifié et actif (implicite, aucune ligne à stocker) |
| `moderator` | Modération du catalogue public et des signalements |
| `platform_admin` | Utilisateurs, organisations, référentiels, paramètres |
| `super_admin` | Gestion technique ; attribution des rôles `platform_admin` |

Stockage : table `platform_roles (user_id, role, granted_by, granted_at)`. Aucun
utilisateur ne peut y écrire ; seule une fonction privilégiée le fait.

Règles critiques pour Supabase :

- un rôle ne se lit **jamais** dans `user_metadata`, que l'utilisateur modifie lui-même ;
  les rôles se lisent en table, par les fonctions de la section 7.4 ;
- les connexions anonymes de Supabase Auth sont désactivées : elles donneraient le rôle
  PostgreSQL `authenticated` à un visiteur ;
- un compte suspendu perd tous ses droits : l'état du compte (`account_status`) est
  vérifié par les fonctions de rôle, sans attendre l'expiration du jeton.

### 2.2 Organisation (tenant)

Une organisation est un établissement, une bibliothèque ou une institution. C'est l'unité
d'isolation : `organization_id` porte le tenant.

| Rôle | Portée dans l'organisation |
|---|---|
| `org_admin` | Membres, rôles, paramètres et catalogue de l'organisation |
| `librarian` | Catalogue institutionnel : import, métadonnées, droits d'accès |
| `teacher` | Publication de ressources au nom de l'organisation |
| `member` | Lecture des ressources réservées à l'organisation |

Stockage : `organization_members (organization_id, user_id, role)`, unique sur
`(organization_id, user_id)`.

Règles :

- Un utilisateur peut n'appartenir à aucune organisation : c'est le cas par défaut d'un
  étudiant inscrit seul. Il peut appartenir à plusieurs.
- On ne devient membre que par une invitation acceptée : un `org_admin` n'ajoute personne
  sans son consentement.
- L'appartenance à une organisation ne donne **aucun** accès aux projets, notes ou
  collections des autres membres.
- Un rôle d'organisation ne vaut que pour cette organisation. Aucune requête ne traverse
  deux organisations.
- Une organisation est créée par un `platform_admin`. Elle porte un état : `pending`,
  `verified`, `suspended`. Seul `verified` permet la publication directe (section 5.1).
- Dans une organisation `suspended`, `has_org_role` renvoie faux pour tous : plus aucun
  droit d'organisation ne s'exerce, et ses ressources réservées ne sont plus servies.
- Un `platform_admin` ne peut ni vérifier ni administrer une organisation dont il est membre.
- La dernière ligne `org_admin` d'une organisation ne peut pas être supprimée ni rétrogradée.

### 2.3 Projet de recherche

| Rôle | Portée dans le projet |
|---|---|
| propriétaire | L'étudiant auteur. Un seul par projet. Tous les droits. |
| `supervisor` | Encadreur invité : lecture, commentaires, tâches, décision sur une version soumise |
| `viewer` | Lecture seule |

Stockage :

- Le propriétaire est porté **uniquement** par `research_projects.owner_id`, fixé par la
  base à la création et non modifiable.
- `research_project_members (project_id, user_id, role, full_access, invited_by)` avec la
  contrainte `role in ('supervisor', 'viewer')`. Il n'existe pas de ligne `owner`.
- `research_project_member_sections (project_id, user_id, section_id)` : sections
  accessibles à un membre dont `full_access` est faux.
- `project_invitations` : invitations en attente (section 5.4).

Un membre ne peut ni modifier ni insérer sa propre ligne. Seul le propriétaire modifie le
rôle ou la portée d'un membre, par une fonction nommée.

**Portée.** Un membre a soit un accès complet (`full_access`), soit un accès limité à une
liste de sections. C'est ce qui réalise les « permissions par projet et par document » du
cahier §6.11. Tout ce qui couvre le document entier — versions, bibliographie complète,
liste des fiches — exige l'accès complet (section 5.3).

## 3. Correspondance avec les rôles du cahier (§4)

| Rôle du cahier | Réalisation |
|---|---|
| Visiteur | `anon` |
| Étudiant | `user`, propriétaire de sa bibliothèque et de ses projets |
| Enseignant / encadreur | `user` + `supervisor` sur les projets partagés ; `teacher` dans son organisation pour publier |
| Bibliothécaire / institution | `librarian` ou `org_admin` dans son organisation |
| Contributeur | Tout `user` auteur d'une soumission ; ce n'est pas un rôle stocké mais la propriété de la soumission |
| Modérateur | `moderator` |
| Administrateur de plateforme | `platform_admin` |
| Super-administrateur | `super_admin`, sans accès au contenu privé (section 6) |

Écart assumé avec le cahier §20 (« un administrateur peut vérifier, publier ou retirer une
ressource ») : ces actions relèvent du rôle `moderator`. Un administrateur les exerce s'il
détient aussi ce rôle, par attribution explicite et tracée. Au lancement, la même personne
peut cumuler les deux.

## 4. Classes de données

| Classe | Tables (cahier §12.2 et compléments) | Clé d'accès |
|---|---|---|
| A. Référentiels | pays, langues, niveaux, `academic_programs`, `subjects`, licences | Lecture publique |
| B. Catalogue | `resources`, `resource_sources`, `resource_licenses`, `resource_tags` ; `resource_internal` pour les notes de modération et preuves d'autorisation | Statut éditorial + visibilité + `organization_id` |
| C. Soumissions | `submissions` | `created_by` |
| D. Signalements et retraits | `resource_reports`, demandes de retrait | Auteur du signalement ; modération |
| E. Profil | `profiles` (privé), `profile_public` (nom d'affichage et champs rendus publics) | `user_id` |
| F. Bibliothèque personnelle | favoris, collections, notes, tags personnels, annotations, historique | `user_id` uniquement |
| G. Projets | `research_projects`, `research_project_members`, `research_project_member_sections`, `project_invitations`, `thesis_sections`, `thesis_versions`, `literature_notes`, `citations`, `bibliographies`, `comments`, tâches | Appartenance au projet et portée |
| H. Fichiers | Table `files` + objets Storage | Ligne `files` rattachée à un projet, une soumission, une ressource ou un utilisateur |
| I. Organisations | `organizations`, `organization_members`, invitations d'organisation | Rôle d'organisation |
| J. Notifications | `notifications` | Destinataire |
| K. Audit | `audit_logs` | Ajout seul ; lecture restreinte |
| L. Rôles et comptes | `platform_roles`, `account_status` | Aucune écriture utilisateur |

Les classes E (hors `profile_public`), F, G, H et J sont **privées par défaut**.

La RLS filtre des lignes, pas des colonnes. Lorsqu'une même entité mêle champs publics et
champs internes, ils sont placés dans deux tables : `profiles` / `profile_public`,
`resources` / `resource_internal`.

## 5. Matrices

Légende : ✔ autorisé · ✖ interdit · `soi` ses propres lignes · `org` dans sa propre
organisation · `F` par fonction privilégiée nommée et auditée (section 7.5).

### 5.1 Catalogue et référentiels (classes A à D)

| # | Opération | anon | user | teacher | librarian / org_admin | moderator | platform_admin |
|---|---|---|---|---|---|---|---|
| 1 | Lire un référentiel | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 2 | Modifier un référentiel | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ |
| 3 | Lire une ressource `published` publique | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 4 | Lire une ressource `published` réservée à une organisation | ✖ | membres `org` | `org` | `org` | ✖ sauf signalement | ✖ |
| 5 | Lire une ressource non publiée | ✖ | `soi` (sa soumission) | `org` | `org` | ✔ (publiques) | ✖ |
| 6 | Télécharger le fichier d'une ressource | selon la ligne 3 et si la licence l'autorise | lignes 3 et 4 | idem | idem | idem | idem |
| 7 | Soumettre une ressource | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 8 | Modifier sa soumission | ✖ | `soi`, si `pending` ou correction demandée | idem | idem | idem | idem |
| 9 | Retirer sa soumission | ✖ | `soi`, avant publication | idem | idem | idem | idem |
| 10 | Lire les pièces jointes d'une soumission | ✖ | `soi` | `soi` | `soi` | ✔, après analyse antivirus | ✖ |
| 11 | Créer ou modifier une ressource institutionnelle non publiée | ✖ | ✖ | `org`, les siennes | `org` | ✖ | ✖ |
| 12 | Publier une ressource institutionnelle | ✖ | ✖ | ✖ | `org`, si organisation `verified` | ✖ | ✖ |
| 13 | Vérifier, publier, rejeter une soumission publique | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ |
| 14 | Modifier une ressource déjà publiée | ✖ | ✖ | ✖ | `F` | `F` | ✖ |
| 15 | Suspendre ou retirer une ressource | ✖ | ✖ | ✖ | `org` | ✔ | ✖ |
| 16 | Signaler une ressource | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 17 | Lire les signalements | ✖ | `soi` | `soi` | ceux visant `org`, sans l'identité du signaleur | ✔ | ✖ |
| 18 | Traiter un signalement ou une demande de retrait | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ |
| 19 | Déposer une demande de retrait | ✔ (limité en débit) | ✔ | ✔ | ✔ | ✔ | ✔ |

Règles associées :

- Publication : une ressource n'est `published` que si la provenance, la licence et le
  statut d'accès sont renseignés. C'est une contrainte de base.
- Ligne 14 : toute modification de la provenance, de la licence, de l'URL, du fichier ou
  de la visibilité d'une ressource publiée la repasse en `pending`. Les autres champs
  (résumé, tags) sont modifiables par une fonction de transition qui conserve l'historique.
- Séparation des tâches : un modérateur ne peut ni vérifier ni publier sa propre soumission.
- Ligne 4 : un modérateur ne voit une ressource réservée que si un signalement la vise,
  et seulement le temps de son traitement.
- Une ressource `suspended` ou `removed` disparaît immédiatement de la recherche (ADR-0004).
- Aucune suppression physique d'une ressource publiée : passage à `removed`, avec
  conservation de l'historique de décision (cahier §7.3).
- Les notes de modération, la preuve d'autorisation et l'identité du contributeur sont
  dans `resource_internal`, illisible par `anon` et par les simples utilisateurs.

### 5.2 Données personnelles (classes E, F, J)

| Opération | anon | user | tout rôle d'organisation, moderator, platform_admin, super_admin |
|---|---|---|---|
| Lire `profile_public` d'un utilisateur | ✔ si le titulaire l'a publié | idem | idem |
| Lire le nom d'affichage d'un co-membre de projet | ✖ | ✔, entre membres d'un même projet | ✖ |
| Lire `profiles` (profil complet) | ✖ | `soi` | ✖ |
| Modifier son profil | ✖ | `soi` | ✖ |
| Favoris, collections, notes, annotations, historique : toute opération | ✖ | `soi` | ✖ |
| Notifications : lire, marquer lues | ✖ | `soi` | ✖ |
| Créer une notification | ✖ | ✖ | `F` (système) |
| Exporter ses données | ✖ | `soi`, sous sa propre session | ✖ |
| Supprimer son compte | ✖ | `soi`, par `F` après ré-authentification | ✖ |

Par défaut, `profile_public` est vide : ni l'établissement, ni la filière, ni les projets
ne sont publics (cahier §6.2). L'administration des comptes (suspension) passe par une
fonction privilégiée qui ne renvoie que l'identifiant, l'adresse et l'état du compte.

La suppression d'un compte ne supprime aucune ligne d'`audit_logs`. Les identifiants y
restent sous forme d'UUID qui ne renvoient plus à aucune donnée : c'est la
pseudonymisation retenue, le journal étant en ajout seul.

### 5.3 Projets de recherche (classes G et H)

« Complet » : membre dont `full_access` est vrai. « Limité » : membre restreint à une
liste de sections.

| # | Opération | propriétaire | supervisor | viewer | tout autre utilisateur ou rôle |
|---|---|---|---|---|---|
| 1 | Créer un projet | ✔ (tout `user`) | — | — | — |
| 2 | Lire la fiche du projet (titre, statut, échéances) | ✔ | ✔ | ✔ | ✖ |
| 3 | Lire une section | ✔ | ✔ complet, ou section autorisée | idem | ✖ |
| 4 | Modifier le projet, les sections, les fiches, les citations | ✔ | ✖ | ✖ | ✖ |
| 5 | Lire les fiches de lecture, citations, bibliographie | ✔ | ✔ complet seulement | ✔ complet seulement | ✖ |
| 6 | Supprimer le projet (suppression logique) | ✔ | ✖ | ✖ | ✖ |
| 7 | Lire la liste des membres | ✔ | ✔ | ✔ | ✖ |
| 8 | Lire les invitations en attente | ✔ | ✖ | ✖ | ✖ |
| 9 | Inviter, modifier la portée, retirer un membre | `F` | ✖ | ✖ | ✖ |
| 10 | Quitter le projet | ✖ | `F` | `F` | — |
| 11 | Créer une version, la soumettre | `F` | ✖ | ✖ | ✖ |
| 12 | Lire une version soumise | ✔ | ✔ complet seulement | ✔ complet seulement | ✖ |
| 13 | Accepter, refuser, demander une correction sur une version soumise | ✖ | `F`, complet seulement | ✖ | ✖ |
| 14 | Lire les commentaires | ✔ | ceux des sections qu'il peut lire | idem | ✖ |
| 15 | Commenter | ✔ | sections qu'il peut lire | ✖ | ✖ |
| 16 | Modifier ou supprimer un commentaire | le sien | le sien | — | ✖ |
| 17 | Résoudre un fil de commentaires | `F` | `F` | ✖ | ✖ |
| 18 | Lire les tâches et échéances | ✔ | ✔ | ✔ | ✖ |
| 19 | Créer une tâche | ✔ | ✔ | ✖ | ✖ |
| 20 | Modifier ou clore une tâche | ✔ | celles qu'il a créées | ✖ | ✖ |
| 21 | Téléverser ou supprimer un fichier | `F` | ✖ | ✖ | ✖ |
| 22 | Obtenir une URL signée de lecture d'un fichier | `F` | `F`, complet ou section autorisée | idem | ✖ |
| 23 | Exporter le projet (PDF, DOCX) | ✔ | ✖ | ✖ | ✖ |
| 24 | Activer un traitement IA externe sur le projet | `F` | ✖ | ✖ | ✖ |
| 25 | Publier le mémoire dans le catalogue | `F`, par consentement explicite | ✖ | ✖ | ✖ |

Règles associées :

- Un projet est créé privé, sans autre membre que son propriétaire.
- « Tout autre utilisateur ou rôle » inclut `org_admin`, `librarian`, `moderator`,
  `platform_admin` et `super_admin`.
- Tout commentaire et tout fichier de projet porte un `section_id`, ou est réservé aux
  membres à accès complet. Un membre limité ne voit rien qui ne soit rattaché à ses sections.
- Une version est un instantané du document entier : elle exige l'accès complet (ligne 12).
- Les versions soumises et les décisions rendues sont immuables : aucune politique
  `update` ni `delete`. Une nouvelle décision s'ajoute à l'historique.
- Ligne 6 : la suppression est logique, avec un délai avant purge. L'historique des
  décisions est conservé jusqu'à la purge.
- Le retrait d'un membre prend effet à la requête suivante. La durée de vie courte des
  URL signées borne l'accès résiduel à un fichier.
- La publication d'un mémoire crée une soumission (classe C) distincte ; le projet reste privé.
- Le consentement à un traitement IA externe est enregistré par projet, horodaté et
  révocable ; il est vérifié en base avant chaque appel (cahier §13.3).
- Existence : une lecture refusée et une lecture d'un projet inexistant donnent la même
  réponse. Pour les écritures, les identifiants sont des UUID aléatoires et les messages
  d'erreur de contrainte ne sont pas relayés au client, afin de ne pas servir d'oracle.

### 5.4 Invitation à un projet

Table `project_invitations (id, project_id, email, role, full_access, token_hash,
expires_at, status, accepted_by)`.

- **Par adresse.** Le jeton est aléatoire, à usage unique, expire, et n'est stocké que
  haché. L'acceptation passe par `accept_project_invitation(token)` : la fonction compare
  l'adresse invitée à `auth.users.email` de l'appelant, avec `email_confirmed_at` non nul.
  Elle ne lit ni le jeton d'accès ni `user_metadata`.
- **Par lien.** Un lien ne donne **aucun droit**. La personne qui l'ouvre, une fois
  authentifiée, crée une demande à l'état `pending`. Le propriétaire voit son nom
  d'affichage et son adresse, puis confirme ou refuse. Le rôle n'existe qu'après confirmation.
- Le propriétaire voit les invitations et les demandes en attente et peut les révoquer.
- La création d'invitations est limitée en débit, en base.
- Une invitation ne révèle pas si l'adresse correspond à un compte existant.

### 5.5 Organisations (classe I)

| Opération | user | member | teacher | librarian | org_admin | platform_admin |
|---|---|---|---|---|---|---|
| Lire la fiche publique d'une organisation | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Lire sa propre appartenance | — | ✔ | ✔ | ✔ | ✔ | — |
| Lire la liste des membres | ✖ | ✖ | ✖ | ✖ | `org` | ✖ |
| Inviter un membre | ✖ | ✖ | ✖ | ✖ | `F`, `org` | ✖ |
| Accepter une invitation d'organisation | `F` | — | — | — | — | — |
| Retirer un membre, changer un rôle | ✖ | ✖ | ✖ | ✖ | `F`, `org` | ✖ |
| Modifier les paramètres de l'organisation | ✖ | ✖ | ✖ | ✖ | `F`, `org` | ✖ |
| Quitter l'organisation | — | `F` | `F` | `F` | `F`, sauf dernier `org_admin` | — |
| Créer, vérifier, suspendre une organisation | ✖ | ✖ | ✖ | ✖ | ✖ | `F`, sauf s'il en est membre |
| Désigner le premier `org_admin` | ✖ | ✖ | ✖ | ✖ | ✖ | `F`, jamais lui-même |
| Consulter les statistiques | ✖ | ✖ | ✖ | `org`, agrégées | `org`, agrégées | agrégées |

Les statistiques sont agrégées et anonymisées, avec un seuil minimal d'effectif : elles ne
permettent pas de retrouver l'activité ou le projet d'une personne.

### 5.6 Rôles de plateforme, comptes et audit (classes K et L)

| Opération | user | moderator | org_admin | platform_admin | super_admin |
|---|---|---|---|---|---|
| Lire ses propres rôles | ✔ | ✔ | ✔ | ✔ | ✔ |
| Attribuer ou retirer `moderator` | ✖ | ✖ | ✖ | `F` | `F` |
| Attribuer ou retirer `platform_admin` | ✖ | ✖ | ✖ | ✖ | `F` |
| Attribuer `super_admin` | ✖ | ✖ | ✖ | ✖ | ✖ (hors application, procédure à deux personnes) |
| Suspendre un compte sans rôle de plateforme | ✖ | ✖ | ✖ | `F` | `F` |
| Suspendre un `moderator` | ✖ | ✖ | ✖ | `F` | `F` |
| Suspendre un `platform_admin` | ✖ | ✖ | ✖ | ✖ | `F` |
| Suspendre un `super_admin` | ✖ | ✖ | ✖ | ✖ | ✖ (hors application) |
| Écrire dans le journal d'audit | ✖ | ✖ | ✖ | ✖ | ✖ (écrit par la base) |
| Lire le journal d'audit | ses propres événements de sécurité ; pas les changements de rôle ou de statut le concernant, qui portent l'identifiant de l'administrateur | événements de modération | événements d'administration de `org` | tous, sans contenu privé | tous, sans contenu privé |
| Modifier ou supprimer une ligne d'audit | ✖ | ✖ | ✖ | ✖ | ✖ |

Règles associées :

- Personne ne modifie son propre rôle ni ne se suspend ou se rétablit lui-même.
- **MFA imposé en base.** Pour `moderator`, `platform_admin`, `super_admin` et `org_admin`,
  les fonctions de rôle ne renvoient vrai que si la session est de niveau `aal2`. Un compte
  privilégié sans second facteur actif n'a que les droits d'un `user`. MFA proposé aux
  encadreurs (cahier §10.2).
- Une attribution de rôle exige en plus une session récente.
- « Événements d'administration de `org` » : changements de membres, de rôles, de
  paramètres et publications institutionnelles. L'activité personnelle des membres
  (recherches, bibliothèque, projets) n'en fait pas partie.
- Le journal d'audit ne contient jamais de contenu de mémoire, de note, de jeton ni de
  mot de passe (cahier §11.7).

## 6. Accès exceptionnel du super-administrateur

Le cahier §4.8 exclut tout accès automatique au contenu privé. En conséquence :

- aucune politique RLS ne donne au rôle `super_admin` la lecture des classes E, F, G, H, J ;
- l'accès exceptionnel n'existe pas dans l'application du MVP ;
- s'il devient nécessaire (incident, obligation légale), il passera par une procédure hors
  ligne : demande motivée, double validation, durée limitée, périmètre limité à un projet,
  journalisation renforcée et information de l'utilisateur lorsque la loi le permet.
  Cette procédure fera l'objet d'un document dédié avant toute mise en œuvre.

L'accès technique direct à la base de production (console du fournisseur, connexion
PostgreSQL) contourne la RLS. Il est limité à un nombre minimal de personnes, protégé par
MFA et tracé par le fournisseur. Ce risque est traité dans le modèle de menaces
(M-21, M-54 et risques résiduels).

## 7. Mise en œuvre

### 7.1 Chemin d'accès aux données (ADR-0007)

L'API Supabase (PostgREST, Auth, Storage) est joignable par quiconque détient la clé
publique, sans passer par l'application. Trois décisions en découlent.

1. **Pas de client de données Supabase dans le navigateur.** Le navigateur ne parle qu'à
   Next.js. La session est portée par des cookies `HttpOnly` posés par le serveur ; le
   jeton d'accès n'est pas lisible par le JavaScript de la page.
2. **Lecture sous la session de l'utilisateur.** Le serveur interroge Supabase avec le
   jeton de l'utilisateur : la RLS s'applique à chaque lecture.
3. **Écritures sensibles par fonctions nommées.** Sur les classes C à L, les droits
   `insert`, `update` et `delete` directs sont retirés au rôle `authenticated` partout où
   une règle métier, un nettoyage ou une ligne d'audit est requis. L'écriture passe par
   une fonction (section 7.5) qui valide, applique la règle et écrit l'audit dans la même
   transaction. Les écritures simples et sans enjeu (favoris, notes personnelles) restent
   en RLS directe.

Conséquence : un appel direct à PostgREST avec un jeton valide n'obtient rien de plus que
ce que l'application permet.

| Couche | Rôle |
|---|---|
| Contraintes, droits par colonne, triggers | Formats, bornes, schémas d'URL, immutabilité, statuts : imposés en base |
| RLS PostgreSQL | Barrière de lecture, et d'écriture là où elle est directe |
| Fonctions nommées | Écritures sensibles, transitions d'état, audit |
| Table `files` + URL signées | Seul accès aux objets Storage (section 7.3) |
| Code serveur Next.js | Validation des entrées, nettoyage du contenu riche, limitation de débit, messages d'erreur ; **répète** la base, ne la remplace pas |
| Interface | Affichage seulement ; jamais une sécurité |

Limites imposées côté base ou plateforme, et non dans le seul code : nombre maximal de
lignes par réponse, délai d'exécution des requêtes par rôle, longueur des champs,
limitation de débit des invitations et des soumissions.

Journalisation des lectures (cahier §11.7) : l'accès à un projet partagé, le
téléchargement d'un fichier et l'export passent par des fonctions qui écrivent l'audit.
Une lecture RLS directe d'une ligne par son propriétaire n'est pas journalisée.

### 7.2 Règles RLS

- RLS activée et forcée sur chaque table du schéma exposé, dans la migration qui crée la table.
- Une politique par opération et par rôle PostgreSQL (`anon`, `authenticated`). Pas de
  politique `for all`.
- Toute politique `update` porte un `with check`.
- **Immutabilité.** Un `with check` ne compare pas l'ancienne et la nouvelle valeur. Les
  colonnes de propriété (`owner_id`, `created_by`, `organization_id`, `user_id`,
  `project_id`) et de statut sont donc protégées par des droits par colonne (pas de
  `update` accordé) ou par un trigger qui refuse le changement.
- Les colonnes de propriété sont fixées par la base à l'insertion (`default auth.uid()`),
  et vérifiées par `with check`.
- Les statuts ne changent que par des fonctions de transition.
- Les tables enfants d'un projet contrôlent l'accès par le projet et la section parents,
  pas par une colonne recopiée que le client pourrait fausser.
- Les vues exposées sont en `security_invoker`. Aucune vue matérialisée dans un schéma
  exposé : elles ne portent pas de RLS.

### 7.3 Fichiers et Storage

- Buckets privés, avec limites de taille et de types MIME fixées au niveau du bucket.
- **Aucune politique** `select`, `insert`, `update` ou `delete` sur `storage.objects` pour
  `anon` et `authenticated`. Aucun accès direct à un objet n'est possible avec un jeton
  d'utilisateur.
- Table `files (id, owner_id, project_id, section_id, submission_id, resource_id,
  object_path, mime_type, size, scan_status, created_by)`, soumise à la RLS selon les
  matrices 5.1 et 5.3.
- **Téléversement** : une fonction serveur crée la ligne `files` à l'état `pending`, génère
  le chemin de l'objet et émet une URL signée d'envoi. Le nom fourni par l'utilisateur
  n'entre jamais dans le chemin.
- **Lecture** : une fonction serveur vérifie, sous la session de l'appelant, que la ligne
  `files` lui est visible et que `scan_status = 'clean'`, écrit une ligne d'audit, puis
  émet une URL signée de courte durée.
- Tant que l'analyse antivirus n'a pas conclu, le fichier n'est lisible que par celui qui
  l'a envoyé.
- Un objet n'est jamais déplacé ni renommé : toute modification crée une nouvelle ligne.
- Aucun bucket n'est créé avant la mise en place de ce mécanisme (Phase 2).

### 7.4 Fonctions d'appui des politiques

```text
is_project_owner(project_id)             propriétaire du projet
is_project_member(project_id, roles[])   membre du projet avec l'un des rôles
can_read_section(section_id)             propriétaire, membre complet, ou section autorisée
has_full_project_access(project_id)      propriétaire ou membre à accès complet
has_org_role(organization_id, roles[])   rôle dans une organisation non suspendue
has_platform_role(roles[])               rôle de plateforme
my_org_ids(roles[])                      organisations où l'appelant détient l'un des rôles
is_account_active()                      compte non suspendu
```

Règles :

- `security definer`, `stable`, `search_path` fixé, dans un schéma **non exposé** par l'API.
- Aucun paramètre d'identité : elles lisent `auth.uid()`.
- Toutes vérifient `is_account_active()`.
- `has_platform_role`, et `has_org_role` pour `org_admin`, exigent une session `aal2`.
- Leur propriétaire est un rôle qui n'est pas soumis à la RLS des tables qu'elles lisent,
  pour éviter toute récursion entre politiques.
- Droit d'exécution : retiré explicitement à `public`, `anon` et `authenticated`, puis
  accordé fonction par fonction. `anon` n'en exécute aucune : les politiques `anon` ne
  portent que sur le statut et la visibilité des ressources publiées et des référentiels.

### 7.5 Fonctions privilégiées

Inventaire fermé. Chaque fonction contrôle elle-même l'appelant, applique la règle et
écrit l'audit. Tout ajout modifie ce document et passe en revue de sécurité.

**Exécutées sous la session de l'utilisateur** (`security definer`, appelées par RPC
depuis le serveur) :

| Fonction | Appelant autorisé |
|---|---|
| Inviter, modifier la portée, retirer un membre de projet | Propriétaire |
| `accept_project_invitation`, demande par lien, confirmation | Invité ; propriétaire pour la confirmation |
| Quitter un projet ou une organisation | Le membre |
| Créer et soumettre une version | Propriétaire |
| Rendre une décision sur une version | `supervisor` à accès complet |
| Résoudre un fil de commentaires | Propriétaire, `supervisor` |
| Transitions de statut d'une soumission ou d'une ressource | Selon la matrice 5.1 |
| Modifier une ressource publiée | `librarian`, `org_admin`, `moderator` |
| Enregistrer ou révoquer le consentement IA d'un projet | Propriétaire |
| Publier un mémoire (crée une soumission) | Propriétaire |
| Inviter un membre d'organisation, changer un rôle, accepter | `org_admin` ; l'invité pour l'acceptation |
| Enregistrer un téléversement, demander une URL de lecture | Selon la matrice |

**Exécutées avec `service_role`, côté serveur uniquement :**

| Opération | Contrôle préalable |
|---|---|
| Émission des URL signées Storage | Ligne `files` visible sous la session de l'appelant, `scan_status` |
| Attribution et retrait de rôles de plateforme | Rôle de l'appelant, `aal2`, session récente |
| Création, vérification, suspension d'une organisation | `platform_admin`, non membre |
| Suspension et rétablissement de compte | Matrice 5.6 |
| Suppression de compte à la demande du titulaire | Ré-authentification du titulaire |
| Import par connecteur | Tâche système ; résultat au statut `pending` au plus |
| Création de notifications | Tâche système |
| Analyse antivirus d'un fichier | Tâche système ; n'écrit que `scan_status` |
| Vérification des liens du catalogue | Tâche système ; ressources publiques seulement |

Règles de `service_role` :

- Toute opération vérifie l'identité par un appel au serveur d'authentification
  (`getUser()`), jamais par la seule lecture du cookie de session.
- `service_role` n'est jamais utilisé pour lire un projet au nom d'un utilisateur dans une
  requête interactive.
- **Tâches différées sur du contenu privé** (export long, traitement IA) : la tâche est
  créée par une demande explicite du propriétaire, porte l'identifiant d'un seul projet,
  ne lit que ce projet, vérifie le consentement pour l'IA, écrit une ligne d'audit à la
  lecture, et son résultat n'est remis qu'au demandeur. L'export simple s'exécute sous la
  session de l'utilisateur.
- La modération s'exerce sous la session du modérateur, par RLS et fonctions de
  transition. Elle n'utilise pas `service_role`.

### 7.6 Configuration Supabase

Fixée dans la première migration et la configuration du projet, contrôlée en CI :

- schémas exposés par l'API : liste explicite ; les fonctions d'appui et les tables
  internes n'y figurent pas ;
- `revoke execute on all functions ... from public, anon, authenticated` et
  `alter default privileges` correspondant, pour que toute nouvelle fonction soit fermée
  par défaut ;
- même fermeture par défaut pour les droits sur les tables ;
- Realtime désactivé ; une table n'est ajoutée à la publication qu'après revue, et jamais
  une table privée tant que le filtrage des événements n'est pas vérifié ;
- API GraphQL désactivée ;
- connexions anonymes désactivées ; confirmation de l'adresse obligatoire ;
- aucun trigger ne recopie `raw_user_meta_data` vers une colonne d'autorisation ;
- durée de vie du jeton d'accès : 10 minutes au plus (valeur à confirmer en B-10) ;
- CAPTCHA et limites de débit activés sur l'API d'authentification ;
- la fonction de recherche n'est pas `security definer`.

### 7.7 Recherche

La recherche publique ne lit que les ressources `published` de visibilité publique. Aucune
table des classes E, F, G, H, J n'alimente un index ou une vue de recherche (ADR-0004).
La recherche dans sa propre bibliothèque ou son propre projet est une requête distincte,
soumise aux politiques de ces tables.

## 8. Tests obligatoires

Chaque migration qui crée ou modifie une table livre les tests correspondants. Jeu
d'acteurs minimal : `anon`, étudiant A, étudiant B, encadreur de A à accès complet, lecteur
de A limité à une section, membre de l'organisation 1, administrateur de l'organisation 1,
administrateur de l'organisation 2, modérateur, administrateur de plateforme, compte suspendu.

| Famille | Cas |
|---|---|
| Horizontal | B ne lit, ne modifie ni ne supprime rien de A (classes E, F, G, H, J) |
| Vertical | Un `user` ne s'attribue aucun rôle ; un `org_admin` n'agit pas sur la plateforme |
| Inter-tenant | L'organisation 2 ne voit rien de l'organisation 1 |
| Organisation ≠ projet | L'administrateur de l'organisation de A ne lit pas le projet de A |
| Administration ≠ contenu | Modérateur et administrateur de plateforme ne lisent pas le projet de A |
| Partage | L'encadreur lit après acceptation, plus après retrait ; il ne modifie pas le contenu |
| Invitation | Un lien seul ne donne aucune lecture ; rejeu refusé ; mauvaise adresse refusée ; pas de ligne `owner` insérable |
| Portée | Le lecteur limité ne lit ni les autres sections, ni leurs commentaires, ni leurs fichiers, ni aucune version |
| Déplacement | Un `update` ne peut pas changer `owner_id`, `project_id`, `section_id` ou `organization_id` |
| Statuts | Aucune publication sans provenance ni licence ; pas d'auto-modération ; une ressource publiée modifiée repasse en `pending` |
| Fichiers | Aucun accès direct à `storage.objects` ; pas d'URL sans contrôle ; fichier non analysé illisible par un tiers |
| Appel direct | Chaque interdiction est vérifiée par un appel direct à l'API Supabase avec le jeton de l'acteur, pas seulement par l'application |
| MFA | Un modérateur en session `aal1` n'a aucun droit de modération |
| Suspension | Un compte suspendu n'a plus aucun droit avant l'expiration de son jeton |
| Recherche | Aucun contenu privé ou non publié dans les résultats |
| Existence | Même réponse pour « interdit » et « inexistant » |
| Audit | Aucune modification ni suppression possible ; une ligne par action sensible |
| Configuration | Aucune table exposée sans RLS ; aucune fonction exécutable par `anon` hors liste |

Chaque table est testée pour les quatre opérations, y compris avec le rôle `anon`.

## 9. Questions ouvertes

| # | Question | Position retenue par défaut |
|---|---|---|
| 1 | Accueil de lycéens mineurs dès le MVP | Non tranché ; conditionne le consentement parental et les limites de profil (cahier §15) |
| 2 | Co-auteurs sur un projet | Exclu : non prévu au cahier |
| 3 | Un encadreur voit-il les brouillons ou seulement les versions soumises | Sections dans sa portée, et versions soumises s'il a l'accès complet |
| 4 | Invitation par lien | Conservée, mais sans aucun droit avant confirmation du propriétaire |
| 5 | Une organisation `verified` publie-t-elle sans modération de la plateforme | Oui, avec suspension possible par un modérateur |
| 6 | Cumul `platform_admin` + `moderator` au lancement | Autorisé par attribution explicite |
