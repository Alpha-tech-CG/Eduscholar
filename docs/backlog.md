# Backlog EduScholar

**Mise à jour :** 6 octobre 2026
**Phase en cours :** Phase 0 — Fondation

Statuts : `à faire`, `en cours`, `bloqué`, `fait`.
Une tâche n'est démarrée qu'après validation de son plan (méthode de `CLAUDE.md`).

## Phase 0 — Fondation

| ID | Tâche | Agent | Dépend de | Critère de validation | Statut |
|---|---|---|---|---|---|
| B-01 | Initialiser Git, créer `.gitignore`, premier commit | orchestrateur | — | `git status` propre, `.env*` ignoré | fait |
| B-02 | Décisions d'architecture : monorepo, framework web, backend, données et autorisation, authentification, recherche, hébergement, i18n | orchestrateur + décision du porteur de projet | — | Un enregistrement de décision par choix dans `docs/architecture/` | fait — ADR-0001 à ADR-0006 |
| B-03 | Matrice rôles × ressources × opérations et modèle multi-tenant | orchestrateur, security-reviewer | B-02 | Les 8 rôles du cahier §4 couverts, règles d'appartenance projet et organisation écrites | fait — `docs/security/authorization-model.md` v2, revu par l'agent sécurité ; validé le 6 octobre 2026 avec ADR-0007 |
| B-04 | Modèle de menaces initial | security-reviewer | B-02 | `docs/security/threat-model.md` couvrant les 10 menaces du cahier §17 | fait — 56 menaces, revu par l'agent sécurité |
| B-05 | Brouillons des politiques : confidentialité, contenu et licences, retrait, consentement IA, mineurs | orchestrateur | — | Documents dans `docs/product/`, marqués « à valider juridiquement » | fait — cinq brouillons ; validation juridique à obtenir avant ouverture au public |
| B-06 | Taxonomie pilote (informatique) et liste des sources autorisées avec licences | orchestrateur | — | Filière, matières, niveaux, pays ISO, langues, sources et conditions d'usage documentés | fait — `taxonomy-pilot.md`, `authorized-sources.md` ; à valider par le porteur de projet |
| B-07 | Gouvernance des agents : 3 agents manquants, durcissement de `settings.json`, format de rapport unique | orchestrateur | — | Écarts 2 à 4 de `docs/current-state.md` et constats S-03, S-04, S-08 levés | fait |
| B-08 | Socle technique sans fonctionnalité métier : structure du dépôt, TypeScript strict, lint, typecheck, tests, i18n fr/en, en-têtes de sécurité, `.env.example`, CI avec scan de secrets et audit des dépendances | frontend-engineer, backend-engineer, qa-engineer | B-01, B-02 | `npm run lint`, `typecheck`, `test` et `build` passent en local et en CI | fait — ADR-0008 à valider ; la CI n'a jamais tourné faute de dépôt distant |
| B-09 | Schéma de fondation : profils, organisations, membres, journal d'audit, avec politiques d'accès et tests d'isolation | database-engineer, security-reviewer | B-02, B-03, B-08 | Migration versionnée, tests utilisateur A / B et organisation A / B verts | fait — trois migrations, 139 tests pgTAP ; revue de l'agent sécurité intégrée |
| B-10 | Authentification : inscription, connexion, déconnexion, réinitialisation, sessions | backend-engineer, frontend-engineer, qa-engineer, security-reviewer | B-08, B-09 | Messages d'erreur génériques, cookies sécurisés, limitation de débit, tests verts | fait — voir `docs/architecture/authentication.md` ; revue de l'agent sécurité intégrée, dont deux constats élevés confirmés et corrigés |

## Phase 1 — MVP recherche

| ID | Tâche | Dépend de | Statut |
|---|---|---|---|
| B-11 | Profil académique (pays, niveau, filière, langue, confidentialité par défaut) | B-10 | fait — profil exigé à la première connexion, déclaration d'âge datée par la base, suppression de compte |
| B-12 | Référentiels : pays, langues, niveaux, filières, matières | B-06, B-09 | fait — 249 pays ISO, langues, niveaux, filière informatique, 6 spécialités, 29 matières |
| B-13 | Schéma du catalogue : ressources, sources, licences, tags, statuts d'accès et éditoriaux | B-09 | fait — licences, types, fiches, données internes, historique, signalements ; les tags viendront avec la recherche (B-16) |
| B-14 | Administration et modération : vérifier, publier, retirer une ressource, avec audit | B-13 | fait — proposition, suivi par le contributeur, file de modération, décisions motivées et journalisées, séparation des tâches ; l'attribution des rôles reste manuelle (D-01) |
| B-15 | Import manuel et premier connecteur (OpenAlex ou Crossref) | B-13, B-06 | fait — import par DOI via Crossref, réservé aux modérateurs ; OpenAlex (clé et budget à décider) et l'import en lot restent à faire |
| B-16 | Recherche avec au moins trois filtres, fiche ressource avec origine et statut d'accès | B-13 | fait — recherche plein texte, cinq filtres, fiche publiée, signalement ; réservée aux comptes connectés |
| B-17 | Favoris et collections privées | B-13 | fait — favoris, collections, ajout depuis la fiche, strictement privés |

## Phase 3 — Atelier de recherche

Découpée le 6 octobre 2026 d'après le cahier §6.7 à §6.10 et §19. Le partage avec un
encadreur (membres, invitations, commentaires, versions) relève de la Phase 4 : en
Phase 3, un projet n'a d'autre lecteur que son propriétaire.

| ID | Tâche | Dépend de | Statut |
|---|---|---|---|
| C-01 | Projet de recherche privé : fiche du projet (cahier §6.7), création, modification, suppression logique | B-11 | fait — fiche complète, strictement privée, purge à trente jours planifiée chaque nuit |
| C-02 | Sources du projet, saisies ou reprises du catalogue ; fiche de lecture par source ; matrice de littérature (§6.8) | C-01, B-16 | fait — sources saisies ou reprises d'une fiche publiée, fiche de lecture, matrice ; rien n'est inventé ni complété |
| C-03 | Bibliographie de base (APA) construite à partir des seules sources du projet ; références incomplètes et doublons signalés (§6.10) | C-02 | fait — APA 7e édition en français ou en anglais, signalements, texte à copier ; autres styles et import BibTeX/RIS non faits |
| C-04 | Plan du mémoire : chapitres et sections rédigés en texte, citations liées aux sources (§6.9, version simple) | C-02 | fait — plan ordonné sur trois niveaux, texte simple, sources citées par section avec leurs pages, protection contre l'écrasement ; sans enregistrement automatique ni mise en forme riche |
| C-05 | Export du projet (document imprimable en PDF, DOCX) ; export des données personnelles, bibliothèque comprise (D-22) | C-03, C-04 | fait — page imprimable (PDF par le navigateur), DOCX et Markdown sans dépendance, copie de ses données en JSON avec mot de passe redemandé et trace |

## Dette de sécurité à solder avant la production

Issue des revues de l'agent sécurité. Chaque ligne a une échéance.

| ID | Sujet | Échéance |
|---|---|---|
| D-01 | Fonctions d'attribution de rôle et de suspension sous la session de l'administrateur : **fait** (écran `/admin`, `service_role` n'écrit plus les rôles). Reste : les organisations (invitation, rôles, dissolution), où le rôle serveur écrit encore | Avec les organisations partenaires (D-04) |
| D-02 | Authentification récente pour les opérations d'administration ; refus d'attribuer un rôle à un compte sans second facteur | fait |
| D-03 | Journal d'audit : partitionnement par mois, conservation, export hors base | Avant la production |
| D-04 | Renommage d'une organisation par fonction, avec nouvelle vérification ; dissolution d'une organisation | Avec les organisations partenaires |
| D-05 | Contrôle automatique de `supabase/config.toml` en CI ; configuration des projets hébergés par `supabase config push` | À la création du projet de staging |
| D-06 | Dépôt distant : épingler les actions par empreinte, `CODEOWNERS`, protection de `main` | À la création du dépôt |
| D-07 | Copie chiffrée hors plateforme de la base et des fichiers ; exercice de restauration | Avant la production |
| D-08 | Mesure du plan d'exécution des politiques sur un journal d'audit volumineux | Avec D-03 |
| D-09 | Authentification : CAPTCHA, contrôle des mots de passe compromis, alerte de nouvelle connexion, journalisation des événements de sécurité (échecs, limites atteintes). Sans CAPTCHA, un appel direct à l'API d'authentification n'est limité que par adresse IP. | Avant l'ouverture publique |
| D-10 | Exiger le mot de passe actuel pour un changement fait par appel direct à l'API d'authentification avec une session ordinaire (réglage du service à vérifier sur le projet hébergé) | À la création du projet de staging |
| D-11 | Enregistrer la déclaration d'âge en base et l'exiger à la première connexion, quel que soit le chemin d'inscription | fait en B-11 |
| D-12 | Purger les comptes jamais confirmés | fait — effacés après sept jours par la purge nocturne (jamais connectés, sans rôle ni organisation) |
| D-13 | Neutraliser ou personnaliser les modèles de courriel non utilisés (lien magique, changement d'adresse, invitation, réauthentification) | fait en local — un même message sans lien ni code ; **à reproduire sur chaque projet hébergé** (modèles de courriel du tableau de bord) |
| D-14 | Suppression de son compte par l'utilisateur, avec le cas du dernier administrateur d'une organisation | fait en B-11 ; le transfert d'administration reste à construire (D-04) |
| D-15 | Requêtes imbriquées coûteuses par l'API (un utilisateur connecté peut encore en lancer sur les référentiels, jusqu'au délai de 8 secondes) : limitation de débit devant l'API, mesure de charge | Avant l'ouverture publique, avec D-09 |
| D-17 | Second facteur : codes de secours | fait — dix codes à usage unique, levée du second facteur depuis la connexion |
| D-18 | Courriel de notification à l'activation et à la désactivation du second facteur ; fermeture des autres sessions à l'activation | fait pour l'activation et la désactivation par le titulaire ; reste D-27 |
| D-27 | Courriel au titulaire quand un code de secours lève son second facteur, et quand des codes sont générés : le service d'authentification n'en envoie pas sur ces chemins, il faut un envoi de courriel applicatif ou une confirmation par courriel avant la levée (ADR à écrire). Adresse de contact dans les modèles de courriel, une fois l'entité désignée. | Avant l'ouverture publique |
| D-19 | Révocation immédiate : un jeton d'accès déjà émis restait valable jusqu'à dix minutes après la fermeture des sessions | fait — la base vérifie que la session du jeton existe encore (`is_session_live`, dans `is_account_active`) : toutes les lectures et écritures, pas seulement les opérations sensibles |
| D-28 | Rejeu d'un code à six chiffres entre deux pas de trente secondes | fait — la base refuse tout second code du même facteur pendant 60 à 90 s ; l'application annonce l'attente au lieu d'envoyer le code, pour ne pas déconnecter un titulaire trop rapide |
| D-29 | Suspension d'un compte : fermer ses sessions auprès du service d'authentification | fait — sessions supprimées dans la transaction de la suspension, et plus aucune session ouvrable tant que le compte est suspendu (refus en base, après vérification du mot de passe). Le « bannissement » du service a été écarté : il révèle la sanction à qui ne connaît pas le mot de passe. Reste : dire au titulaire que son compte est suspendu (il reçoit aujourd'hui le message d'un mot de passe erroné) — par courriel à la suspension, avec D-27. **Sur un projet hébergé : vérifier que la migration peut poser un déclencheur sur `auth.sessions`.** |
| D-30 | Modération : la liste des signalements ouverts montre les cent plus anciens, sans dire qu'il en reste ni permettre de voir les suivants (constaté quand les données de test locales ont dépassé cent). Ajouter le total et une pagination, comme pour la file des ressources. | Avant l'ouverture publique |
| D-20 | Connecteurs : pause après une réponse `429` en respectant `Retry-After` ; plafond journalier de requêtes par source ; signaler sur la fiche les champs modifiés après import | Avant l'import en lot ou OpenAlex |
| D-21 | Recherche : l'index plein texte n'est pas utilisé sous RLS (47 ms pour 50 000 fiches). Avant 200 000 fiches ou au-delà de 300 ms : fonction de recherche dédiée (ADR à écrire), compteur estimé, classement par pertinence. Étendre D-15 à la table des ressources. Fixer la durée de conservation des journaux d'accès, qui contiennent les mots cherchés. | Avant l'import en lot |
| D-22 | Bibliothèque : inclure favoris et collections dans l'export des données personnelles | fait en C-05 |
| D-23 | Planifier la purge des données à durée de conservation et vérifier son exécution | fait en local — `private.run_scheduled_purges()` chaque nuit par pg_cron ; **sur chaque projet hébergé : activer pg_cron avant la migration, puis vérifier `cron.job_run_details`** ; aucune alerte si la tâche échoue (à relier à la supervision, D-08) |
| D-24 | Rédaction : enregistrement automatique et sortie de conflit sans rechargement ; limite de débit sur les enregistrements | fait — enregistrement 2,5 s après la dernière frappe, choix de la version à garder en cas de conflit, 200 enregistrements par 10 minutes et par compte (en base). L'historique des versions reste en Phase 4. |
| D-25 | Exports : tâche différée ou réponse en flux pour un gros compte (durée et taille de réponse de l'hébergeur) ; inclure dans la copie des données le journal de sécurité du compte et les projets supprimés en attente de purge ; courriel de notification après un export | Avant l'ouverture publique |
| D-16 | Garde empêchant le dernier `super_admin` de supprimer son compte ou de perdre son rôle ; second facteur exigé pour supprimer un compte qui en a un | fait |
| D-26 | Journal d'audit : la suppression en cascade d'un compte attribue la ligne du rôle supprimé à l'administrateur qui l'avait accordé ; journaliser les tentatives d'administration refusées ; historique des motifs de suspension ; pagination de la liste des comptes à rôle | Avec D-03 |

## Phases suivantes (non détaillées)

- Phase 2 — Bibliothèque : notes, import DOI/BibTeX/RIS, dédoublonnage, vérification des liens.
- Phase 3 — Atelier de recherche : projet de mémoire, fiches de lecture, bibliographie, export.
- Phase 4 — Encadrement : invitation, commentaires, versions, validations.
- Phase 5 — Internationalisation et mobile.
- Phase 6 — Intelligence documentaire.

## Décisions en attente du porteur de projet

| Sujet | Question |
|---|---|
| Nom | EduScholar, StudyHub ou ScholarCampus |
| Données | Tranché le 6 octobre 2026 : Supabase avec RLS (ADR-0001) |
| Backend | Tranché : routes et Server Actions de Next.js pour le MVP (ADR-0003) |
| Hébergement | Tranché : Vercel et Supabase hébergé (ADR-0006) ; région des données à choisir |
| Pays pilotes | Lesquels pour le lancement |
| Mineurs | La plateforme accueille-t-elle des lycéens mineurs dès le MVP ; par défaut : majeurs uniquement (`docs/product/minors-policy.md`) |
| Accès aux données | Tranché le 6 octobre 2026 : ADR-0007 accepté |
| Modèle d'autorisation | Tranché le 6 octobre 2026 : `authorization-model.md` accepté |
| Modèle économique | Gratuit, payant ou institutionnel : conditionne les licences non commerciales et l'usage de CORE |
| Taxonomie et sources | Valider `docs/product/taxonomy-pilot.md` et `docs/product/authorized-sources.md` |
| Juriste | Désigner qui valide les cinq brouillons de `docs/product/` |
| Outillage du socle | Valider ADR-0008, dont l'exception d'audit sur `braces` (expire le 6 janvier 2027) |
| Dépôt distant | Créer le dépôt GitHub : première exécution de la CI, protection de `main`, `CODEOWNERS` |
| `.env.example` | Le créer à la main en B-09, ou autoriser les agents à écrire ce seul fichier |
| Entité et contact | Entité juridique responsable et adresse de contact, à porter dans les politiques |

## Couverture des critères d'acceptation du MVP (cahier §20)

| Critère | Tâche | État |
|---|---|---|
| Créer un compte et choisir sa filière | B-10, B-11 | couvert |
| Rechercher avec au moins trois filtres | B-16 | couvert |
| Origine et statut d'accès affichés | B-13, B-16 | couvert |
| Vérifier, publier, retirer une ressource | B-14 | couvert |
| Collection privée | B-17 | couvert |
| Projet de recherche privé | Phase 3 (C-01) | couvert |
| Sources et fiches de lecture | Phase 3 (C-02) | couvert |
| Bibliographie sans source inventée | Phase 3 (C-03) | couvert |
| Export du projet | Phase 3 (C-05) | couvert |
| Pas d'accès sans partage explicite | B-09, Phase 3 (C-01) | couvert pour la fiche du projet ; à étendre aux sources et sections |
| Pas d'URL publique permanente pour un fichier privé | Phase 3 | non couvert |
| Actions sensibles auditables | B-09, B-14 | non couvert |
| Sauvegardes restaurables en test | À planifier | non couvert |
