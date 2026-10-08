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
| `20261006003600_live_session.sql` | Une session fermée cesse d'agir immédiatement : contrôle de la session du jeton dans `is_account_active` |
| `20261006003800_second_factor_replay.sql` | Un code accepté interdit tout second code pendant 60 à 90 s ; attente lisible par le titulaire |
| `20261006003900_suspension_closes_sessions.sql` | La suspension d'un compte ferme ses sessions |
| `20261006004000_suspended_no_session.sql` | Un compte suspendu n'ouvre plus de session |
| `20261006004100_personal_export_complete.sql` | Copie des données personnelles : événements du compte et projets supprimés en attente de purge |
| `20261006004200_connector_gate.sql` | Sources externes : pause demandée par la source et plafond journalier, tenus en base |
| `20261006004300_audit_retention.sql` | Conservation du journal d'audit : mécanisme dans la purge nocturne, inactif tant qu'aucune durée n'est posée |
| `20261006004400_review_batch_hardening.sql` | Corrections de revue : liste fermée des événements du compte, exception de purge limitée au journal d'audit, réglage de conservation borné |
| `20261006004500_project_sharing.sql` | Partage d'un projet : membres, invitations par adresse, lecture par un membre |
| `20261006004600_project_sharing_hardening.sql` | Corrections de revue du partage : invitations annulées au retrait, plafond par destinataire, débit de lecture, purge des invitations closes |
| `20261006004700_project_comments.sql` | Commentaires sur les sections d'un projet partagé |
| `20261006004800_sharing_account_deletion.sql` | Les colonnes « qui a invité, écrit, clos » perdent leur clé étrangère : elles faisaient échouer la suppression d'un compte |
| `20261006004900_project_comments_hardening.sql` | Corrections de revue des commentaires : plafonds par auteur, rôle exigé pour modifier, fil clos fermé aux réponses, adresse rendue au seul propriétaire, identifiant retiré à la suppression d'un compte |
| `20261006005000_thesis_versions.sql` | Versions soumises et décisions de l'encadreur |
| `20261006005100_thesis_versions_hardening.sql` | Corrections de revue des versions : tailles bornées, lecture autorisée avant chargement, garde d'immuabilité, effacement du contenu d'une version, copie des données |
| `20261006005200_project_tasks.sql` | Tâches et échéances d'un projet partagé |
| `20261006005300_project_tasks_hardening.sql` | Corrections de revue des tâches : copie des données après retrait, plafond par membre, quota des modifications à part, intitulé sur une ligne |
| `20261006005400_notifications.sql` | Notifications internes du suivi d'un projet, écrites par déclencheurs |
| `20261006005500_notifications_hardening.sql` | Corrections de revue des notifications : pas de doublon, plafond par projet, effacement au retrait d'un membre |
| `20261006005600_member_scope.sql` | Portée d'un membre limitée à certaines sections |
| `20261006005700_share_links.sql` | Lien de partage et demandes soumises à l'accord du propriétaire |
| `20261006005800_scope_and_links_hardening.sql` | Corrections de revue : invitations annulées à chaque décision sur un membre, fiche réduite pour un accès limité, délai après refus |
| `20261006005900_notification_emails.sql` | Courriel facultatif des notifications, désabonnement par jeton, rappel d'échéance |
| `20261006006000_notification_emails_hardening.sql` | Corrections de revue : traces d'audit, comptes bannis, rappel retenté |
| `20261006006100_sign_in_alert_and_auth_events.sql` | Navigateurs connus d'un compte, compteurs des échecs et limites de l'authentification |
| `20261006006200_sign_in_alert_hardening.sql` | Corrections de revue : enregistrement par le serveur seul, compte ancien sans navigateur connu, oubli au changement de mot de passe |
| `20261006006300_admin_audit_followup.sql` | Historique des suspensions, consignation des opérations d'administration refusées |
| `20261006006500_admin_refusal_hardening.sql` | Corrections de revue : refus déclarables bornés au rôle, plafonds, dépassement signalé |
| `20261006006400_resource_search_function.sql` | Recherche du catalogue par une fonction dédiée (ADR-0010) |
| `20261006006600_resource_search_hardening.sql` | Corrections de revue : mots courts, filtres hors référentiel, index partiel |
| `20261006006700_edited_after_import.sql` | Champs d'une fiche importée modifiés depuis l'import, tenus par déclencheur |
| `20261006006800_admin_refusals_in_database.sql` | Refus d'administration consignés par la base, réponse 403 sans erreur levée ; conservation de l'historique des suspensions |
| `20261006006900_admin_refusals_hardening.sql` | Corrections de revue : toutes les lectures couvertes, plafond de plateforme, purge prudente |
| `20261006007000_reference_data_function.sql` | Référentiels rendus par une fonction ; lecture directe retirée aux comptes |
| `20261006007100_organization_administration.sql` | Organisations administrées par fonctions ; le rôle serveur n'y écrit plus |
| `20261006007200_organization_members.sql` | Invitations, rôles et départs des membres d'une organisation |
| `20261006007300_organization_admin_invitation.sql` | Un administrateur d'organisation s'invite, il ne se désigne pas |
| `20261006007400_organization_hardening.sql` | Corrections de revue : reprise réservée, motifs, traces |
| `20261006007500_organization_recovery_rules.sql` | Seconde revue : reprise définie par l'état, interdits durables, période d'observation |
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
code accepté interdit tout autre succès du même facteur jusqu'à la fin du deuxième pas
de trente secondes suivant (60 à 90 s) — le service accepte aussi le code des pas
voisins, qui pourrait sinon resservir. La fonction n'est exécutable que par
`supabase_auth_admin`. `second_factor_wait_seconds()` rend au titulaire l'attente
restante.

Un déclencheur sur `private.account_status` supprime les sessions du compte
(`auth.sessions`, et leurs jetons de rafraîchissement) quand il devient suspendu. Un
second, sur `auth.sessions`, refuse toute nouvelle session à un compte suspendu : le
service d'authentification ne l'atteint qu'après avoir reconnu le mot de passe ou le
lien, si bien qu'un tiers n'apprend rien d'un essai avec un mauvais mot de passe.

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

Le même passage efface les compteurs de débit de plus de deux jours, et les lignes du
journal d'audit plus anciennes que la durée de conservation — si elle a été posée. Elle
ne l'est pas par défaut : c'est une décision juridique. Le propriétaire de la base la
pose hors application (`private.platform_settings`, clé `audit_retention_months`, entre
6 et 120 mois) ; hors de cette purge, le journal reste en ajout seul pour tous,
propriétaire compris.

Mesure du 7 octobre 2026, journal d'un million de lignes, utilisateur ordinaire sous
RLS : 240 ms pour lire la page de ses cinquante derniers événements, 350 ms pour les
compter, 120 ms pour `my_account_events`. Le partitionnement par mois est remis au-delà
de cinq millions de lignes.

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
signalements, projets supprimés en attente de purge (`my_deleted_projects`) et événements
du journal qui concernent le compte (`my_account_events` : date et nature, jamais
l'auteur ni le détail). Ce qu'elle n'inclut pas est indiqué dans le fichier lui-même
(`not_included`). Le mot de passe
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

### `public.research_project_members` et `public.project_invitations`

Partage d'un projet (E-01). `research_project_members` : `project_id`, `user_id`, `role`
(`supervisor` ou `viewer` — il n'existe pas de ligne propriétaire), `full_access`,
`invited_by`. `project_invitations` : `project_id`, `email` (en minuscules), `role`,
`token_hash` (empreinte SHA-256 d'un jeton de 256 bits, qui n'est jamais conservé),
`expires_at` (sept jours), `status`, `accepted_by`.

- aucune lecture ni écriture directe, pour aucun rôle de l'API : tout passe par des
  fonctions ;
- propriétaire : `invite_project_member` (rend le jeton une seule fois, que l'application
  envoie par courriel), `revoke_project_invitation`, `remove_project_member`,
  `project_sharing` ;
- personne invitée : `invitation_preview` et `accept_project_invitation` ne répondent que
  si l'appelant est connecté sous l'adresse invitée, confirmée ; jeton inconnu, expiré,
  révoqué, déjà utilisé ou destiné à quelqu'un d'autre donnent la même réponse vide ;
- membre : `shared_projects`, `shared_project_document` (fiche, sections, sources,
  citations ; jamais les fiches de lecture), `leave_project`. Les tables du projet lui
  restent fermées : il ne lit que par ces fonctions, qui revérifient son appartenance —
  un retrait prend effet à la requête suivante ;
- plafonds : 20 invitations par jour et par compte, 3 par jour vers une même adresse
  tous expéditeurs confondus (compteur sur l'empreinte de l'adresse), 10 en attente et
  10 membres par projet ; 120 lectures du document par quart d'heure et par membre ;
  verrou consultatif `project_sharing:<projet>` ;
- retirer un membre annule les invitations encore en attente à son adresse ;
- les invitations closes ou expirées depuis trente jours sont effacées chaque nuit
  (tâche `eduscholar-invitations-purge`) : elles portent l'adresse de tiers ;
- écarts voulus, plus stricts que la matrice du modèle d'autorisation : un membre ne lit
  ni les fiches de lecture, ni la liste des autres membres ;
- l'ouverture et la fermeture d'un partage sont inscrites au journal, au compte du
  propriétaire (`project.shared`, `project.unshared`).

### `public.project_comments`

Commentaires sur les sections d'un projet partagé (E-02) : `project_id`, `section_id`
(toujours renseignée), `parent_id` (réponse à un commentaire de premier niveau ; un seul
niveau), `author_id`, `body` (2 000 caractères, texte simple), `quote` (passage visé,
recopié, 400 caractères, une ligne), `edited_at`, `deleted_at`, `resolved_at`,
`resolved_by`.

- aucune lecture ni écriture directe ; `private.project_role` dit la place de l'appelant
  dans le projet (`owner`, `supervisor`, `viewer`) ou refuse — même réponse pour un
  projet inexistant, supprimé ou fermé à l'appelant ;
- `add_project_comment` : propriétaire et encadreur ; `update_project_comment` et
  `delete_project_comment` : l'auteur, tant qu'il est propriétaire ou encadreur ;
  `resolve_project_thread` : propriétaire et encadreur ; `project_comments` : tous les
  membres, lecteur compris ;
- un commentaire auquel on a répondu, supprimé par son auteur, garde sa place dans le
  fil sans son texte ; un fil clos ne reçoit plus de réponse ;
- l'adresse d'un auteur n'est rendue qu'au propriétaire (pour ses membres) ; les membres
  voient la place de chacun, et l'adresse du propriétaire, qu'ils connaissent déjà ;
- plafonds : 200 commentaires par jour et par compte ; par projet, 300 pour le
  propriétaire, 150 par membre et 300 pour l'ensemble des membres — un membre ne peut
  pas priver le propriétaire de la parole ;
- `author_id`, `resolved_by`, et les colonnes « qui a invité » du partage sont de
  simples identifiants, sans clé étrangère (une mise à vide en cascade faisait échouer
  la suppression du compte du propriétaire). À la suppression d'un compte, un
  déclencheur sur `auth.users` les met à vide dans les projets d'autrui : les
  commentaires restent dans le suivi de l'étudiant, sans identifiant de leur auteur ;
- écart voulu, plus strict que le modèle : un membre à portée limitée ne lit ni n'écrit
  de commentaire tant que la portée par section n'existe pas (E-06).

### `public.thesis_versions` et `public.version_decisions`

Versions soumises et décisions de l'encadreur (E-03). `thesis_versions` : `project_id`,
`number` (suite par projet), `label`, `note`, `snapshot` (le document tel qu'il était :
titre, sections, sources, citations — jamais les fiches de lecture), `word_count`,
`section_count`, `size_bytes`, `erased_at`. `version_decisions` : `version_id`,
`decision` (`accepted`, `changes_requested`, `rejected`), `comment` (obligatoire sauf
pour accepter), `decided_by`, `decided_at`.

- aucune lecture ni écriture directe ; `submit_thesis_version` : le propriétaire ;
  `decide_thesis_version` : l'encadreur seul, ni le propriétaire ni un lecteur ;
  `project_versions` et `project_version` : propriétaire et membres à accès complet ;
- historique en ajout seul : un déclencheur refuse toute modification, même au
  propriétaire de la base. Deux exceptions : le retrait de l'identifiant d'un compte
  supprimé, et `erase_thesis_version`, par laquelle le propriétaire efface le contenu
  d'une version soumise par erreur — la trace de la soumission et les décisions
  restent, l'effacement est journalisé (`project.version_erased`) ;
- la lecture d'une version autorise avant de charger, et ne rend de la version
  précédente que l'empreinte de ses sections : assez pour dire ce qui a changé ;
- plafonds : 5 soumissions par jour et par compte, 30 versions par projet, 3 Mo par
  version et 60 Mo pour l'ensemble des versions d'un compte ; 50 décisions par jour et
  20 par version ; 120 lectures de liste et 60 lectures de version par quart d'heure ;
- l'adresse de l'encadreur n'est rendue qu'au propriétaire, et tant que cet encadreur
  est membre du projet.

### `public.project_tasks`

Tâches et échéances d'un projet partagé (E-04) : `project_id`, `title` (200 caractères,
une ligne), `details`, `due_date`, `created_by`, `done_at`, `done_by`.

- aucune lecture ni écriture directe ; `project_tasks` : propriétaire et membres à accès
  complet, lecteur compris ; `add_project_task` : propriétaire et encadreur ;
  `update_project_task` et `delete_project_task` : le propriétaire pour toutes,
  l'encadreur pour celles qu'il a créées ;
- la modification est partielle (seules les clés présentes) ; clore ou rouvrir passe
  par la clé `done` ;
- plafonds : 50 créations et 200 modifications par jour et par compte ; 100 tâches par
  projet, dont 30 ouvertes au plus par membre — un membre ne remplit pas le projet à la
  place de son propriétaire ;
- la copie des données rend les tâches de ses projets, et celles qu'on a posées
  ailleurs tant qu'on y est encore membre ;
- écart voulu, plus strict que le modèle : un membre à portée limitée ne lit pas les
  tâches tant que la portée par section n'existe pas (E-06).

### `public.notifications`

Notifications internes du suivi d'un projet (E-05) : `user_id` (destinataire), `kind`
(`comment`, `reply`, `version_submitted`, `version_decided`, `task_added`),
`project_id`, `section_id`, `version_id`, `read_at`. Aucun contenu : une notification
dit ce qui s'est passé et où.

- écrites par la base seulement, par des déclencheurs posés sur les commentaires, les
  versions, les décisions et les tâches, dans la transaction de l'événement : aucun
  appel ne peut en fabriquer ;
- destinataire : le propriétaire si un membre a agi ; les encadreurs à accès complet si
  c'est le propriétaire ; jamais l'auteur de l'événement, ni un simple lecteur ;
- `my_notifications` (cinquante plus récentes) et `my_unread_notification_count` ne
  rendent que les notifications de projets encore ouverts à l'appelant : retiré d'un
  projet, on ne voit plus celles qui le concernent ; `mark_notifications_read` ne
  touche que les siennes ;
- une notification identique encore non lue n'est pas répétée ; cinquante non lues au
  plus par destinataire et par projet, pour qu'un projet n'étouffe pas les autres ; les
  notifications d'un membre partent avec son appartenance ; lues depuis trente jours ou
  vieilles de six mois, elles sont effacées chaque nuit (tâche
  `eduscholar-notifications-purge`) ;
- pas d'envoi par courriel dans cette tranche : il demande des préférences et un
  désabonnement.

### Portée d'un membre et liens de partage (E-06)

`research_project_member_sections (project_id, user_id, section_id)` : sections ouvertes
à un membre dont `full_access` est faux. `project_invitations.section_ids` : portée
proposée par une invitation limitée. `project_share_links` : lien de partage (empreinte du
jeton, rôle proposé, sept jours, un seul actif par projet). `project_access_requests` :
demandes faites par lien (`pending`, `approved`, `refused`).

- `private.project_access` rend la place de l'appelant et s'il a l'accès complet ;
  `private.section_access` la rend pour une section, si elle lui est ouverte — section
  inconnue, d'un projet fermé ou hors portée : même refus ;
- un membre limité lit le titre, le statut et l'échéance du projet, et ses sections
  ouvertes avec leurs commentaires ; un encadreur limité les commente. Il ne lit ni le
  titre des autres sections, ni la description détaillée du projet, ni sources et
  citations, ni versions, ni tâches : `private.project_role`, qui garde versions et
  tâches, exige toujours l'accès complet ;
- `set_member_scope` (propriétaire) fixe la portée ; elle prend effet à la requête
  suivante. Toute création ou modification d'une appartenance annule les invitations en
  attente vers l'adresse du membre : seule vaut la dernière décision du propriétaire ;
- lien de partage : `create_project_link` rend le jeton une seule fois ;
  `request_project_access` ne rend ni ne lève rien selon le lien, et ne dit rien du
  projet ; `decide_access_request` (propriétaire) accepte — accès complet, au rôle que
  proposait le lien — ou refuse. Une demande refusée ne se répète pas avant trente
  jours ; désactiver le lien refuse les demandes en attente ;
- plafonds : 10 liens et 10 demandes par jour et par compte, 20 demandes en attente par
  projet, une seule par personne et par projet ;
- liens expirés ou désactivés et demandes closes sont effacés après trente jours, les
  demandes sans réponse après quatre-vingt-dix (tâche `eduscholar-invitations-purge`).

### Courriel des notifications et rappel d'échéance (E-05)

`notification_preferences (user_id, email_digest, unsubscribe_token, last_emailed_at,
updated_at)` : le choix de recevoir un courriel quand de nouvelles notifications
attendent. Désactivé par défaut ; aucun droit direct, pour aucun rôle de l'API.

- `set_notification_preferences` (le titulaire) fixe le choix ; activer repart d'un jeton
  neuf et ne prévient pas de ce qui attendait déjà ;
- `claim_notification_digests` (rôle de service) rend l'adresse et le jeton de
  désabonnement des personnes à prévenir, et les marque comme prévenues dans la même
  requête. Sont exclus : compte suspendu, banni ou supprimé, adresse non confirmée,
  personne prévenue depuis moins de vingt heures, et qui n'a rien de nouveau qu'elle
  puisse encore voir (`private.notification_visible_to`, la règle des notifications
  internes). Chaque envoi laisse au journal une ligne qui ne porte qu'un nombre ;
- `unsubscribe_notifications` (rôle de service) coupe le courriel de qui présente le
  jeton, et le remplace. Jeton inconnu ou mal formé : rien, sans le dire. Le titulaire
  lit ce désabonnement parmi les événements de son compte. Le jeton est gardé en clair :
  il doit figurer dans chaque courriel, et ne permet que cela ;
- `private.notify_due_tasks` (tâche `eduscholar-task-reminders`, chaque jour) écrit une
  notification `task_due` au propriétaire et aux encadreurs à accès complet pour une
  tâche non faite dont l'échéance tombe sous deux jours. `project_tasks.reminded_for`
  retient l'échéance déjà rappelée : la déplacer la rappelle de nouveau. Un rappel non lu
  vaut pour toutes les tâches proches du projet ; un rappel qui n'a pas pu s'écrire est
  retenté le lendemain.

### Alerte de nouvelle connexion et compteurs de l'authentification (D-09)

`known_devices (user_id, device_hash, first_seen_at, last_seen_at)` : navigateurs depuis
lesquels un compte s'est déjà connecté — l'empreinte d'un témoin aléatoire et deux dates,
rien d'autre. `private.auth_event_counters (hour, kind, total)` : échecs et limites
atteintes, par heure et par nature. Aucun droit direct sur l'une ni l'autre.

- `register_sign_in_device` (rôle de service, pour le compte dont le mot de passe vient
  d'être accepté) retient le navigateur et rend vrai si le titulaire doit être prévenu :
  navigateur inconnu d'un compte qui en connaît d'autres, ou d'un compte créé depuis plus
  d'une heure qui n'en connaît aucun. Aucun utilisateur ne l'appelle. Vingt navigateurs
  au plus par compte ; trois avis par jour, au-delà le navigateur est retenu sans
  courriel. L'empreinte mêle le témoin et le compte : deux comptes ouverts depuis le même
  poste ne sont pas reliés ;
- changer de mot de passe fait oublier les navigateurs connus du compte (déclencheur sur
  `auth.users`), que le changement passe par l'application ou non ;
- `my_known_devices` (le titulaire, compte actif) : les dates seulement, pour la copie de
  ses données ;
- `record_auth_event` (rôle de service) ajoute un à un compteur ; une nature qui n'a pas
  la forme attendue est ignorée, de sorte qu'aucune adresse ne peut s'y glisser ;
- `admin_auth_events` (administration, second facteur récent) : les nombres des sept
  derniers jours ;
- navigateurs non revus depuis six mois et compteurs de plus de trois mois sont effacés
  chaque nuit (tâche `eduscholar-auth-traces-purge`).

### Suites du journal d'administration (D-26)

`private.account_status_history (user_id, status, reason, changed_by, changed_at)` :
chaque suspension et chaque rétablissement, écrit par un déclencheur sur
`private.account_status`. Aucun droit direct. L'historique part avec le compte ; si
l'auteur d'une décision supprime le sien, la décision reste sans son identifiant.

- `admin_account_history` (administration, second facteur récent) : les cinquante
  décisions les plus récentes d'un compte, avec l'adresse de leur auteur. La lecture est
  journalisée (`user.history_read`) ;
- les six fonctions d'administration (`admin_find_user`, `admin_account_history`,
  `admin_list_accounts`, `admin_auth_events`, `admin_set_role`,
  `admin_set_account_status`) capturent le refus de droit levé par leur fonction
  interne, le consignent par `private.refuse_admin_operation` et répondent 403 sans
  lever : la trace reste. Les règles, elles, sont toujours dans `private.*`, qui lève ;
- `log_admin_refusal` (administrateur) ne sert plus qu'au refus que l'application oppose
  elle-même : la limite de débit de la recherche d'un compte ;
- cinq lignes par heure sans rôle, trente pour un administrateur, cinq cents pour
  l'ensemble des comptes sans rôle ; chaque dépassement laisse une ligne à lui ;
- `private.purge_status_history` (tâche `eduscholar-status-history-purge`) : trois ans,
  et cinquante décisions par compte au-delà de quatre-vingt-dix jours.

### Organisations (D-01, D-04)

Le rôle serveur n'écrit plus dans `organizations` ni `organization_members` : tout passe
par des fonctions sous la session de l'appelant (détail des droits dans
`authorization-model.md` §2.2, §5.5 et §7.5).

- `organization_invitations` : invitations à rejoindre une organisation — empreinte du
  jeton, rôle, sept jours, `issued_by_platform` et `recovery` pour celles qu'émet la
  plateforme. Aucun droit direct.
- `private.organization_decisions` : motifs de suspension, de rétablissement et de
  dissolution, et invitations de reprise ; trois ans, sauf la suspension en cours.
- `private.organization_departures` : départs récents, pour qu'un administrateur de la
  plateforme n'administre pas une organisation qu'il vient de quitter ; quatre-vingt-dix
  jours.
- `organization_members.recovery_until` : fin de la période pendant laquelle un
  administrateur entré par reprise ne touche pas aux administrateurs antérieurs.
- Tâche `eduscholar-org-invitations-purge` : invitations expirées ou closes depuis trente
  jours.

## Fonctions du schéma `private`

| Fonction | Rôle |
|---|---|
| `is_account_active()` | Vrai si l'appelant est connecté, non anonyme, non suspendu, si sa session l'a vérifié quand un second facteur est activé, et si la session de son jeton existe encore |
| `is_session_live()` | Vrai si la session nommée par le jeton (`session_id`) existe encore dans `auth.sessions` et appartient à l'appelant. Une session fermée — déconnexion, changement de mot de passe, refus d'un code, code de secours — cesse d'agir tout de suite, sans attendre les dix minutes de validité du jeton. Un jeton sans `session_id` n'est pas refusé par ce contrôle : le service n'en émet pas pour un utilisateur |
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
