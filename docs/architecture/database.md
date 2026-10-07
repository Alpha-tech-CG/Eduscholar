# Base de données

**Mise à jour :** 6 octobre 2026 (B-09)
**Références :** `docs/security/authorization-model.md`, ADR-0001, ADR-0007

## Développement local

Prérequis : Docker démarré.

| Commande | Rôle |
|---|---|
| `npm run db:start` | Démarre l'instance Supabase locale et applique les migrations |
| `npm run db:stop` | Arrête l'instance |
| `npm run test:db` | Tests pgTAP de `supabase/tests/database/` |
| `npm run db:lint` | Analyse statique du schéma |
| `npx supabase migration up` | Applique les migrations non encore appliquées |

Ports locaux : API 55321, base 55322, messagerie de test 55324. Ils diffèrent des ports
par défaut de Supabase pour cohabiter avec un autre projet local.

Services locaux désactivés : Realtime, Storage, Studio, fonctions Edge, analytique.
Realtime et Storage le resteront tant que les règles de `authorization-model.md` §7.3 et
§7.6 ne sont pas mises en œuvre.

## Schémas

| Schéma | Exposé par l'API | Contenu |
|---|---|---|
| `public` | oui | Tables applicatives, sous RLS |
| `private` | non | Fonctions d'appui des politiques, état des comptes |
| `auth` | non | Comptes, géré par Supabase |

`supabase/config.toml` : seul `public` est exposé ; `auto_expose_new_tables = false`, donc
une nouvelle table n'est accessible à aucun rôle de l'API sans `GRANT` explicite ;
100 lignes au plus par réponse.

## Migrations

| Fichier | Contenu |
|---|---|
| `20261006000100_foundation.sql` | Fermeture par défaut, tables, fonctions d'appui, déclencheurs, RLS |
| `20261006000200_foundation_hardening.sql` | Corrections de la revue de sécurité : lecture par colonne, acteur de l'audit, politiques évaluées par requête |
| `20261006000300_revoke_residual_privileges.sql` | Retrait de `TRUNCATE`, `REFERENCES` et `TRIGGER` aux rôles de l'API |
| `20261006000400_rate_limits.sql` | Compteurs de limitation de débit de l'authentification |
| `20261006000500_reference_tables.sql` | Référentiels : pays, langues, niveaux, domaines, filières, spécialités, matières |
| `20261006000600_reference_data.sql` | Données des référentiels, générées par `scripts/generate-reference-data.mjs` |
| `20261006000700_academic_profile.sql` | Champs académiques du profil, déclaration d'âge, complétion |
| `20261006000900_second_factor.sql` | Second facteur imposé en base à tout compte qui l'a activé |
| `20261006000800_profile_hardening.sql` | Corrections de la revue de sécurité : complétion vérifiable en base, audit et contrôle de la suppression de compte, référentiels fermés aux visiteurs |
| `20261006001000_catalogue.sql` | Catalogue : licences, types, ressources, données internes, historique des statuts, signalements |
| `20261006001100_catalogue_functions.sql` | Fonctions de soumission, de modération et de signalement |
| `20261006001200_catalogue_policies.sql` | Politiques de lecture du catalogue |
| `20261006001300_my_submissions.sql` | Lecture par un contributeur de ses propres propositions |
| `20261006001500_connector_import.sql` | Import d'une fiche par un connecteur, au nom d'un modérateur |
| `20261006001600_import_hardening.sql` | Corrections de la revue de sécurité : second regard sur une fiche importée, limite journalière sérialisée, réimport après refus |
| `20261006001700_resource_search.sql` | Index plein texte du catalogue, tenu par déclencheur |
| `20261006001800_search_tokens.sql` | Découpage des mots de l'index aligné sur celui de la requête |
| `20261006001900_library.sql` | Favoris et collections privées |
| `20261006002000_library_hardening.sql` | Corrections de la revue de sécurité : description, forme Unicode du nom, renommage sous verrou |
| `20261006002100_research_projects.sql` | Projets de recherche privés |
| `20261006002200_research_projects_hardening.sql` | Corrections de la revue de sécurité : purge, plafond quotidien, modification partielle sans écrasement, échéance |
| `20261006002300_project_sources.sql` | Sources d'un projet et fiches de lecture |
| `20261006002400_project_sources_hardening.sql` | Corrections de la revue de sécurité : plafond quotidien, institution reprise pour les thèses seulement, caractères invisibles des champs d'une ligne |
| `20261006002500_thesis_sections.sql` | Plan du mémoire : sections et sources citées |
| `20261006002600_thesis_sections_hardening.sql` | Corrections de la revue de sécurité : volume de texte, date de modification limitée au contenu, fins de ligne, verrou du projet, plafond de citations |
| `20261006002700_personal_data_export.sql` | Appuis de l'export des données personnelles : identifiants de ses signalements, trace de l'export |
| `20261006002800_administration.sql` | Administration des rôles et des comptes sous la session de l'administrateur ; retrait de l'écriture de `service_role` sur les rôles |
| `20261006002900_administration_hardening.sql` | Corrections de la revue de sécurité : rétablissement selon le rang, opérations toujours tracées, limites en base, garde du dernier super-administrateur |
| `20261006003000_recovery_codes.sql` | Codes de secours de la validation en deux étapes |
| `20261006003100_recovery_codes_hardening.sql` | Corrections de la revue de sécurité : codes de seize signes liés au facteur, usage en session `aal1` seulement, dernier super-administrateur, antériorité du facteur pour `org_admin` |
| `20261006003200_scheduled_purges.sql` | Purge nocturne par pg_cron : projets supprimés depuis trente jours, comptes jamais confirmés depuis sept jours |
| `20261006003300_scheduled_purges_hardening.sql` | Corrections de la revue de sécurité : pas de ligne d'audit par compte purgé, comptes suspendus et courriels récents épargnés, propriétaire de la tâche vérifié |
| `20261006003400_section_autosave.sql` | Enregistrement automatique : la modification d'une section rend sa date de version ; limite de débit par compte |
| `20261006003500_section_autosave_hardening.sql` | Corrections de la revue de sécurité : clé de compteur en empreinte, purge des compteurs, ordre des verrous, forme jugée avant le décompte |
| `20261006001400_review_hardening.sql` | Corrections de la revue de sécurité : essais de second facteur bornés et rejeu refusé, facteur antérieur au rôle, contraintes et séparation des tâches du catalogue |

## Tables

### `public.profiles`

Profil privé. Une ligne par compte, créée par déclencheur à l'inscription.

| Colonne | Type | Contrainte |
|---|---|---|
| `user_id` | uuid | Clé primaire ; référence `auth.users`, suppression en cascade ; non modifiable |
| `preferred_locale` | text | `fr` ou `en` ; défaut `fr` |
| `created_at`, `updated_at` | timestamptz | `updated_at` tenu par déclencheur |

Accès : le titulaire lit sa ligne et modifie `preferred_locale`. Aucune insertion ni
suppression directe.

Champs académiques (B-11), tous privés :

| Colonne | Type | Contrainte |
|---|---|---|
| `country_code` | text | Référence `countries` ; entrée active |
| `level_code` | text | Référence `education_levels` ; entrée active (le lycée est désactivé) |
| `program_code` | text | Référence `academic_programs` ; entrée active |
| `specialty_code` | text | Spécialité de la filière choisie |
| `subject_codes` | text[] | 40 au plus, sans doublon, matières de la filière choisie |
| `institution_name` | text | 2 à 200 caractères ; saisie libre, jamais affichée à un tiers |
| `goals` | text[] | Parmi `courses`, `revision`, `thesis`, `research`, `project` |
| `age_confirmed_at` | timestamptz | Datée par la base ; ne se retire pas, ne se redate pas |
| `onboarded_at` | timestamptz | Calculée par la base quand pays, niveau, filière et déclaration d'âge sont présents ; non modifiable par le client |

Un profil complété ne peut plus être vidé de son minimum. La suppression d'un compte
écrit une ligne `account.deleted` dans le journal.

Le titulaire modifie ces champs directement, sous RLS. Chaque valeur est contrôlée par
la base : un appel direct à l'API ne peut pas enregistrer ce que le formulaire refuserait.

### `public.profile_public`

Partie publiable du profil, séparée parce que la RLS filtre des lignes et non des colonnes.

| Colonne | Type | Contrainte |
|---|---|---|
| `user_id` | uuid | Clé primaire ; référence `profiles`, cascade ; non modifiable |
| `display_name` | text | 1 à 80 caractères, ou nul |
| `is_public` | boolean | Défaut `false` |
| `updated_at` | timestamptz | |

Accès : le titulaire lit et modifie sa ligne ; un utilisateur connecté lit les lignes dont
`is_public` est vrai. Aucun accès anonyme à ce stade.

### `public.platform_roles`

| Colonne | Type | Contrainte |
|---|---|---|
| `user_id` | uuid | Référence `auth.users`, cascade |
| `role` | text | `moderator`, `platform_admin` ou `super_admin` |
| `granted_by` | uuid | Référence `auth.users`, mise à nul ; différent de `user_id` |
| `granted_at` | timestamptz | |

Clé primaire `(user_id, role)`. Accès : chacun lit ses propres rôles (`user_id`, `role`,
`granted_at` ; `granted_by` n'est pas lisible). Écriture par les seules fonctions
d'administration (`admin_set_role`), sous la session de l'administrateur : ni
`authenticated` ni `service_role` n'écrivent dans la table. Seule une session directe
sur la base peut omettre `granted_by`, pour amorcer le premier `super_admin`
(`docs/security/administration.md`). Un déclencheur refuse que le dernier
super-administrateur effectif perde son rôle. Toute modification est journalisée.

### `private.account_status`

État des comptes. Absence de ligne : compte actif. Aucun accès utilisateur.

| Colonne | Type | Contrainte |
|---|---|---|
| `user_id` | uuid | Clé primaire ; référence `auth.users`, cascade |
| `status` | text | `active` ou `suspended` |
| `reason` | text | |
| `changed_by` | uuid | Différent de `user_id` |
| `changed_at` | timestamptz | |
| `suspended_by_rank` | smallint | Rang de l'administrateur qui a suspendu : un rang inférieur ne rétablit pas |

Écrite par `admin_set_account_status` seulement.

### `public.organizations`

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | uuid | Clé primaire, générée ; non modifiable |
| `slug` | text | Unique ; minuscules, chiffres et tirets ; 2 à 80 caractères ; non modifiable |
| `name` | text | 2 à 200 caractères |
| `country_code` | text | Deux majuscules (ISO 3166-1), ou nul |
| `status` | text | `pending`, `verified` ou `suspended` ; défaut `pending` |
| `created_by`, `updated_by` | uuid | Non lisibles par un utilisateur ; obligatoires pour une opération serveur |
| `created_at`, `updated_at` | timestamptz | |

Accès : tout utilisateur connecté lit les organisations vérifiées ; un membre lit la
sienne, sauf si elle est suspendue ; l'administration de la plateforme les lit toutes.
Aucune écriture directe : le renommage passera par une fonction nommée, qui pourra exiger
une nouvelle vérification.

### `public.organization_members`

| Colonne | Type | Contrainte |
|---|---|---|
| `organization_id` | uuid | Référence `organizations`, suppression restreinte ; non modifiable |
| `user_id` | uuid | Référence `auth.users`, cascade ; non modifiable |
| `role` | text | `org_admin`, `librarian`, `teacher` ou `member` |
| `invited_by` | uuid | Non lisible par un utilisateur |
| `created_at` | timestamptz | |

Clé primaire `(organization_id, user_id)` ; index sur `user_id`. Accès : chacun lit sa
propre appartenance ; un `org_admin` lit la liste de son organisation. Aucune écriture
directe. Un déclencheur interdit de retirer ou rétrograder le dernier `org_admin`.

Conséquence à connaître : le compte du dernier `org_admin` d'une organisation ne peut pas
être supprimé tant que l'administration n'a pas été transférée, et une organisation ne se
supprime pas (elle se suspend). La fonction de suppression de compte (B-10) devra
détecter ce cas et l'expliquer. Le verrou du déclencheur suppose le niveau d'isolation
`READ COMMITTED`, qui ne doit pas être changé sur ce chemin.

### `public.audit_logs`

Journal en ajout seul. Aucune clé étrangère vers les comptes : la suppression d'un compte
n'efface aucune ligne.

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | bigint | Identité |
| `occurred_at` | timestamptz | |
| `category` | text | `security`, `moderation`, `organization` ou `platform` |
| `action` | text | Par exemple `platform_roles.insert` |
| `actor_id` | uuid | Auteur : l'utilisateur de la session, sinon l'acteur déclaré par l'opération serveur ; nul pour l'amorçage |
| `subject_user_id` | uuid | Utilisateur concerné |
| `organization_id` | uuid | |
| `target_type`, `target_id` | text | |
| `metadata` | jsonb | 8 ko au plus ; jamais de contenu privé |

Index : `occurred_at`, `(actor_id, occurred_at)`, `(subject_user_id, occurred_at)`,
`(organization_id, occurred_at)`.

Écriture : par déclencheur, dans la transaction de l'action. Modification, suppression et
vidage sont refusés pour tous les rôles, `service_role` compris, qui n'a pas non plus le
droit d'y insérer. Lecture : ses propres événements de sécurité pour un utilisateur ;
ceux de son organisation pour un `org_admin` ; la modération pour un modérateur ; tout
pour l'administration de la plateforme.

Un utilisateur ne lit pas les changements de rôle ou de statut qui le concernent : ces
lignes portent l'identifiant de l'administrateur qui a agi.

Après la suppression d'un compte, ses identifiants restent dans le journal sous forme
d'UUID ne renvoyant plus à aucune donnée : c'est la pseudonymisation retenue.

Reste à faire avant la production : partitionnement par mois, durée de conservation et
export hors base (modèle de menaces M-38).

### Référentiels

`countries`, `languages`, `education_levels`, `academic_domains`, `academic_programs`,
`program_specialties`, `subjects`.

- Clé : un code stable (`code`, ou `program_code` + `code`), non modifiable.
- `labels` : jsonb, avec au moins un libellé `fr` et un libellé `en` non vides.
- `is_active` : une entrée ne se supprime pas, elle se désactive.
- `position` : ordre d'affichage, là où il a un sens.

Lisibles par tout utilisateur connecté, limitées aux entrées actives. Un visiteur
anonyme ne les lit pas par l'API : c'était la seule surface de requête ouverte sans
compte, et aucune page publique n'en a encore besoin. Quand la recherche publique
arrivera (B-16), le serveur les servira lui-même, depuis un cache. Aucune écriture par l'API : les données arrivent par migration. Pour corriger
une donnée, modifier `scripts/generate-reference-data.mjs` ou la taxonomie, puis écrire
une nouvelle migration ; ne jamais retoucher une migration appliquée.

L'API renvoie 100 lignes au plus par réponse : la liste des pays se lit en trois pages.

### Catalogue

`licenses`, `resource_types`, `resources`, `resource_internal`, `resource_status_history`,
`resource_reports` : voir [catalogue.md](catalogue.md) pour le cycle de vie, les
fonctions et les règles de lecture.

### `private.second_factor_recovery_codes` et `private.recovery_code_attempts`

Codes de secours du second facteur : `user_id`, `code_hash` (empreinte SHA-256 liée au
compte ; le code lui-même, seize signes soit quatre-vingts bits, n'est jamais conservé),
`factor_id` (second facteur pour lequel le code vaut), `used_at`. Compteur d'essais
erronés par compte et par fenêtre de quinze minutes. Aucun accès utilisateur ni serveur :
tout passe par les fonctions `generate_recovery_codes`, `redeem_recovery_code`,
`discard_recovery_codes`, `recovery_codes_status` et `last_recovery_code_use`.

`organization_members.role_granted_at` : date d'attribution du rôle, renouvelée par
déclencheur quand le rôle change. Le rôle `org_admin` n'a d'effet que si un second facteur
vérifié lui est antérieur.

### `private.second_factor_attempts`

Une ligne par facteur : début de fenêtre, nombre de codes erronés, dernier pas de trente
secondes accepté. Aucun accès utilisateur. Elle est tenue par
`private.hook_mfa_verification_attempt`, que le service d'authentification appelle à
chaque essai de code : dix codes erronés en quinze minutes bloquent le facteur, et un
même pas de trente secondes ne sert qu'une fois. La fonction n'est exécutable que par
`supabase_auth_admin`.

### `public.research_projects`

Projet de recherche d'un utilisateur (cahier §6.7). Privé : lisible de son seul
propriétaire ; ni la modération, ni l'administration, ni le rôle serveur ne le lisent.

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | uuid | Clé primaire |
| `owner_id` | uuid | Référence `auth.users`, suppression en cascade ; non modifiable |
| `title` | text | 1 à 300 caractères, sans caractère de contrôle ni de format |
| `program_code` | text | Référence `academic_programs`, facultative |
| `status` | text | `draft`, `in_progress`, `completed`, `archived` |
| `due_date` | date | Entre 2000 et 2100 |
| `supervisor_name` | text | 200 caractères ; un simple nom, sans effet sur les droits |
| `context`, `problem_statement`, `theoretical_framework`, `methodology` | text | 5 000 caractères |
| `main_question`, `general_objective` | text | 1 000 caractères |
| `fieldwork`, `population_sample` | text | 2 000 caractères |
| `outline` | text | 10 000 caractères |
| `secondary_questions`, `hypotheses`, `specific_objectives` | text[] | 20 éléments de 1 000 caractères, sans doublon |
| `deleted_at` | timestamptz | Suppression logique ; purge après trente jours |

Index : `(owner_id)` sur les projets non supprimés. Lecture par RLS ; écriture par
`create_project`, `update_project` (seuls les champs présents sont écrits ; une fiche
modifiée entre-temps n'est pas écrasée) et `delete_project`. Plafonds : 20 projets, 20
créations par jour.

### Purges planifiées

`private.run_scheduled_purges()` est appelée chaque nuit à 3 h 17 (UTC) par pg_cron
(tâche `eduscholar-purges`). Elle efface :

- les projets supprimés depuis plus de trente jours, avec leurs sources, fiches de
  lecture, sections et citations ;
- les comptes dont l'adresse n'a jamais été confirmée, qui ne se sont jamais connectés,
  créés depuis plus de sept jours, sans rôle de plateforme, ni appartenance à une
  organisation, ni suspension, et à qui aucun courriel n'a été envoyé dans l'heure.

Elle refuse toute session qui n'est pas celle du propriétaire de la base : aucun rôle de
l'API ne peut la lancer. Un passage qui efface quelque chose écrit une ligne d'audit
`retention.purged` — des nombres, aucun identifiant ; c'est sa seule trace au journal :
le compte purgé n'y laisse pas de ligne `account.deleted`. `purge_deleted_projects()` reste
disponible au rôle serveur.

Sur un projet hébergé, l'extension pg_cron doit être activée avant d'appliquer la
migration, et la migration appliquée sous le rôle `postgres` — elle échoue sinon ;
l'exécution se vérifie dans `cron.job_run_details`. Un échec de la tâche ne
déclenche aucune alerte à ce jour.

Le même passage efface les compteurs de débit de plus de deux jours.

Les tables enfants d'un projet contrôlent l'accès par `private.my_project_ids()`, jamais
par une colonne recopiée, et portent `on delete cascade` vers le projet.

### `public.project_sources` et `public.literature_notes`

Sources bibliographiques d'un projet et fiche de lecture de chacune (cahier §6.8).
Privées, comme le projet : l'accès passe par le projet parent
(`private.my_project_ids()`, `private.my_source_ids()`), jamais par une colonne recopiée.

`project_sources` : `project_id` (cascade, non modifiable), `resource_id` (fiche du
catalogue reprise, `on delete set null`), `source_type` (article, livre, chapitre, thèse,
rapport, conférence, web, autre), `title` (500), `authors` (50 × 200), `publication_year`
(1400–2100), `container_title` (300), `publisher` (200), `volume`, `issue`, `pages` (50),
`doi`, `url` (`http` ou `https`, sans `@`), `accessed_on` (1990–2100). Index :
`(project_id, created_at)`, `(resource_id)`, et unique partiel `(project_id, resource_id)`.

`literature_notes` : clé primaire `source_id` (cascade) ; `problem`, `concepts`, `method`,
`population_field`, `results`, `limits`, `project_link` (3 000 caractères), `useful_quote`
(2 000), `quote_pages` (50), `target_chapter` (200).

Règles :

- lecture par RLS ; écriture par fonctions seulement, la propriété étant vérifiée avant
  tout examen de la requête ;
- une source reprise du catalogue copie titre, auteurs, année, DOI et lien officiel d'une
  fiche publiée ; l'institution n'est reprise que pour une thèse ; rien d'autre n'est
  complété. La copie survit au retrait de la fiche : l'écran retire alors la mention du
  catalogue et n'affiche plus l'adresse en lien ;
- plafonds : 300 sources par projet, 600 ajouts par jour et par compte, projets supprimés
  compris ;
- aucune ligne d'audit ; ni `anon` ni `service_role` n'ont de droit sur ces tables.

**Bibliographie.** Elle n'est pas stockée : la page `/projects/[id]/bibliography` la
calcule à chaque affichage à partir des sources du projet
(`apps/web/src/lib/projects/bibliography.ts`), au format APA 7e édition, en français ou
en anglais. Règles :

- chaque source y figure une fois, et rien d'autre ; un champ absent donne la mention
  convenue (« s. d. ») et un signalement, jamais une valeur supposée ;
- un auteur saisi « Nom, Prénom » est abrégé (« Nom, P. ») ; sans virgule, il est repris
  tel quel et signalé, car rien ne dit où finit le prénom ni s'il s'agit d'un organisme ;
- sont signalés : auteur, année, revue ou ouvrage, éditeur, pages d'un chapitre, adresse
  d'une page web manquants ; doublon par DOI, ou par titre et année ;
- si toutes les sources ne peuvent pas être lues, rien n'est affiché plutôt qu'une
  bibliographie incomplète.

### `public.thesis_sections` et `public.section_citations`

Plan du mémoire (cahier §6.9, version simple) : une liste ordonnée de sections sur trois
niveaux de titres, chacune avec son texte, et les sources du projet qu'elle cite.

`thesis_sections` : `project_id` (cascade, non modifiable), `position` (unique par projet,
contrainte différée pour permettre l'échange de deux rangs), `level` (1 à 3), `title`
(300), `body` (30 000 caractères et 90 000 octets, sauts de ligne simples).
`updated_at` ne suit que le titre, le niveau et le texte : déplacer une section ne la
« modifie » pas.

`section_citations` : clé primaire `(section_id, source_id)`, cascade des deux côtés,
`pages` (50). La source doit appartenir au même projet que la section ; c'est la fonction
`set_section_citation` qui le garantit.

Règles :

- lecture par RLS (`my_project_ids`, `my_section_ids`) ; écriture par fonctions seulement ;
- `update_thesis_section` rend la nouvelle date de modification, que l'éditeur présente à
  l'enregistrement suivant (enregistrement automatique) ; deux cents enregistrements par
  dix minutes et par compte, comptés en base (`private.consume_user_quota`, clé en
  empreinte comme les autres compteurs). Seuls les enregistrements aboutis sont comptés :
  un refus (conflit, plafond de texte) annule son propre décompte, et n'écrit rien ;
- `update_thesis_section` refuse d'écraser un texte modifié depuis sa lecture
  (`expected_updated_at`, code `conflict`) ; l'application fournit toujours cette date ;
- plafonds : 60 sections par projet, 200 sections créées par jour et par compte, 100
  sources citées par section, 3 millions de caractères de texte par compte, projets
  supprimés compris. La limite quotidienne compte les sections existantes : ajouter puis
  supprimer en boucle ne la déclenche pas, le stock restant borné ;
- verrous consultatifs, toujours pris dans cet ordre : `section_quota:<compte>` puis
  `thesis_sections:<projet>` ;
- aucune ligne d'audit ; ni `anon` ni `service_role` n'ont de droit sur ces tables.

### Exports

Aucune table. Le document d'un projet (titre, table des matières, sections, sources
citées, bibliographie) est calculé à la demande par `apps/web/src/lib/projects/document.ts`
et rendu de trois façons qui disent la même chose :

- la page `/projects/[id]/document`, imprimable (PDF par la boîte d'impression du navigateur) ;
- un fichier DOCX, écrit directement — une archive ZIP de fichiers XML — sans bibliothèque
  tierce (`docx.ts`). Validé par un lecteur indépendant ; non essayé dans Microsoft Word ;
- un fichier Markdown.

Rien n'est ajouté, résumé ni reformulé. Un document de plus de 30 000 lignes n'est pas
produit ; si une lecture échoue, rien n'est remis plutôt qu'un document incomplet.

La copie des données personnelles (`/account/export`) est un fichier JSON au format
`eduscholar-personal-data`, version 1 : profil, bibliothèque, projets avec sources, fiches
de lecture, sections et citations, propositions au catalogue avec leur historique,
signalements. Elle n'inclut ni les projets supprimés en attente de purge, ni le journal de
sécurité du compte, ce que le fichier indique lui-même (`not_included`). Le mot de passe
est redemandé et chaque copie laisse un événement `account.data_exported`.

### `private.rate_limit_buckets`

Compteurs de tentatives par fenêtre fixe. Aucun accès utilisateur.

| Colonne | Type | Contrainte |
|---|---|---|
| `bucket_key` | text | 8 à 200 caractères ; une empreinte, jamais une adresse en clair |
| `window_start` | timestamptz | Début de la fenêtre |
| `hits` | integer | Au moins 1 |

Clé primaire `(bucket_key, window_start)` ; index sur `window_start`. Les fenêtres de plus
d'un jour sont purgées au fil de l'eau.

`public.consume_rate_limit(clé, limite, fenêtre)` compte une tentative et dit si elle est
autorisée. Elle est `security invoker` et n'est exécutable que par `service_role`.

## Fonctions du schéma `private`

| Fonction | Rôle |
|---|---|
| `is_account_active()` | Vrai si l'appelant est connecté, non anonyme, non suspendu et, s'il a activé un second facteur, si sa session l'a vérifié |
| `has_verified_factor()` | Vrai si l'appelant a un second facteur vérifié |
| `is_onboarded()` | Vrai si l'appelant a complété son profil minimal, déclaration d'âge comprise |
| `account_deletion_check()` | Contrôle préalable à la suppression de son compte : `ok`, `forbidden` (compte suspendu) ou `last_org_admin` ; journalise la demande. Exposée par une enveloppe `security invoker` du même nom dans `public`. |
| `is_session_aal2()` | Vrai si la session a validé un second facteur |
| `has_platform_role(roles[])` | Compte actif, session au second facteur vérifié, rôle détenu, et facteur vérifié **antérieur** à l'attribution du rôle : un rôle accordé à un compte sans second facteur reste sans effet |
| `must_keep_second_factor()` | Vrai si l'appelant détient un rôle qui exige le second facteur ; l'application refuse alors de le désactiver. Enveloppe du même nom dans `public`. |
| `my_submission_ids()`, `my_report_ids()` | Propositions et signalements de l'appelant, pour les politiques ; vides si le compte n'est pas actif |
| `hook_mfa_verification_attempt(event)` | Borne les essais de code et refuse le rejeu ; appelée par le service d'authentification seulement |
| `has_org_role(organization_id, roles[])` | Compte actif, organisation non suspendue, rôle détenu ; second facteur exigé pour `org_admin` |
| `my_org_ids(roles[])` | Organisations où l'appelant détient l'un des rôles ; utilisée par les politiques pour être évaluée une fois par requête |
| `require_actor_column(colonne)` | Exige l'acteur lors d'une opération serveur |
| `set_organization_actor()` | Renseigne l'acteur d'une modification d'organisation |
| `write_audit(...)` | Écrit une ligne d'audit ; non exécutable par un utilisateur |
| `handle_new_user()` | Crée le profil à l'inscription |
| `prevent_key_change(colonnes...)` | Refuse la modification des colonnes de propriété |
| `protect_last_org_admin()` | Garde au moins un `org_admin` par organisation |
| `audit_row_change(catégorie, colonnes...)` | Journalise les changements des tables d'administration |

Les fonctions `security definer` fixent un `search_path` vide et lisent l'identité par
`auth.uid()`. Aucune ne lit les métadonnées du jeton modifiables par l'utilisateur. Elles
appartiennent au rôle `postgres`, qui n'est pas soumis à la RLS : c'est ce qui évite la
récursion entre politiques alors que la RLS est forcée sur toutes les tables.

## Règles pour toute nouvelle migration

1. RLS activée **et forcée** dans la migration qui crée la table.
2. Une politique par opération, adressée à un rôle nommé, jamais `for all`.
3. `GRANT` explicites, par colonne pour `update`. Aucun droit pour `anon` sans l'ajouter à
   la liste blanche du test de configuration.
4. Colonnes de propriété protégées par `prevent_key_change`.
5. Écritures sensibles par fonction nommée ; l'audit s'écrit en base.
6. Chaque politique inclut `private.is_account_active()`. Toute politique d'écriture
   inclut aussi `private.is_onboarded()`, sauf sur `profiles` : un compte qui n'a pas
   complété son profil ni déclaré son âge n'écrit rien d'autre.
7. Tests pgTAP livrés avec la migration, pour les quatre opérations et le rôle `anon`.
8. Aucune migration destructive sans approbation ; l'en-tête de la migration décrit comment l'annuler.

`supabase/tests/database/00_configuration.test.sql` applique deux familles de contrôles :

- des règles générales, sans nommer de table : RLS activée et forcée, aucun droit pour
  `anon` (droits par colonne et vues compris), aucune écriture de table entière pour
  `authenticated`, vues en `security_invoker`, aucune fonction `security definer` dans le
  schéma exposé, `search_path` vide, rien de publié sur Realtime ;
- des listes fermées : politiques, colonnes modifiables, fonctions exécutables par
  `authenticated`, droits d'écriture de `service_role`.

Toute ouverture nouvelle oblige donc à modifier ce fichier, ce qui la fait passer en
revue. Le fichier vérifie aussi que ses propres règles détectent un objet fautif.

À chaque nouvelle table, ajouter au fichier de configuration : ses politiques, ses
colonnes modifiables et les droits d'écriture de `service_role`.

## Configuration à reproduire sur les projets hébergés

`supabase/config.toml` ne configure que l'instance locale. Avant d'utiliser un projet de
staging ou de production, y appliquer :

| Réglage | Valeur |
|---|---|
| Schémas exposés | `public` uniquement |
| Exposition automatique des nouvelles tables | désactivée |
| Lignes par réponse | 100 |
| API GraphQL | désactivée |
| Realtime | désactivé |
| Connexions anonymes | désactivées |
| Confirmation de l'adresse | obligatoire |
| Durée du jeton d'accès | 600 secondes |
| Durée d'une session | 12 heures au plus, 1 heure d'inactivité |
| Délai entre deux courriels d'authentification | 60 secondes |
| Validité d'un code à usage unique | 15 minutes |
| Longueur du code à usage unique | 10 chiffres : le jeton des liens en dérive |
| Courriel de notification de changement de mot de passe | activé |
| Courriels par heure | à dimensionner selon le trafic, jamais la valeur par défaut de 2 |
| Adresse du site | égale à `APP_URL` |
| Rotation du jeton de rafraîchissement | activée |
| Mot de passe | 12 caractères au moins, lettres et chiffres ; contrôle des mots de passe compromis |
| Changement de mot de passe | ré-authentification exigée par le service après 24 heures de session seulement ; l'application le réserve au lien de réinitialisation (voir `authentication.md`) |
| Second facteur TOTP | activé |
| CAPTCHA de l'authentification | à activer en B-10 (non configuré en local) |
| Limites de débit de l'authentification | activées |
| Fournisseurs d'identité tiers et serveur OAuth | désactivés ; ne pas les activer sans revoir les fonctions de rôle, car ils contrôleraient la revendication `aal` |
| Adresses de redirection | liste exacte, sans joker |
| Accès réseau direct à la base | restreint |

## Non couvert par B-09

- Fonction de renommage d'une organisation et fonction de dissolution.
- Authentification récente exigée pour les opérations d'administration. Un rôle
  privilégié accordé à un compte sans second facteur vérifié est désormais sans effet
  (migration `001400`).
- Partitionnement et conservation du journal d'audit.
- Contrôle automatique de `supabase/config.toml` et de la configuration des projets hébergés.

- Fonctions d'invitation et de gestion des membres d'une organisation.
- Fonctions d'attribution des rôles de plateforme et de suspension de compte.
- Tests par appel direct à l'API avec de vrais jetons : avec l'authentification (B-10).
- Buckets et table `files` : Phase 2.
