# Modèle de menaces initial

**Date :** 6 octobre 2026
**Statut :** initial, version 2 après revue de l'agent sécurité — à réviser à chaque nouvelle surface (upload, connecteurs, IA, mobile)
**Tâche :** B-04
**Références :** cahier §10 à §13, §17 ; ADR-0001 à ADR-0007 ; `authorization-model.md`

Ce modèle est établi avant tout code. Il décrit l'architecture décidée, pas un système
existant : chaque mesure est une exigence à réaliser et à tester, pas un constat.

## 1. Périmètre

Couvert : application web Next.js sur Vercel, Supabase (PostgreSQL, Auth, Storage),
recherche PostgreSQL, connecteurs d'import, assistance IA, exports, chaîne de
développement et de déploiement.

Hors périmètre pour l'instant : application mobile native, paiements, messagerie entre
utilisateurs, notifications WhatsApp/SMS. Chacun exigera une révision de ce document.

## 2. Biens à protéger

| # | Bien | Enjeu |
|---|---|---|
| B1 | Mémoires, thèses, brouillons, fiches de lecture non publiés | Confidentialité : une fuite permet le plagiat et nuit à l'étudiant |
| B2 | Intégrité des travaux et de leur historique | Une perte ou une altération détruit des mois de travail |
| B3 | Comptes et sessions | Porte d'entrée vers B1 et B2 |
| B4 | Données personnelles : identité, établissement, filière, éventuels mineurs | Obligations légales, sécurité des personnes |
| B5 | Fiabilité du catalogue : provenance, licences, métadonnées | Crédibilité académique et risque juridique |
| B6 | Secrets : `service_role`, clés des connecteurs et des fournisseurs IA | Compromission totale |
| B7 | Journal d'audit | Capacité de preuve et d'enquête |
| B8 | Disponibilité et coûts | Service et budget |

## 3. Acteurs de menace

| Acteur | Capacité |
|---|---|
| Visiteur anonyme | Appels directs à l'API Supabase avec la clé publique, automatisation |
| Utilisateur authentifié malveillant | Compte valide, manipulation des requêtes, des identifiants et des fichiers |
| Encadreur ou membre invité | Accès légitime à un projet, tentative d'aller au-delà |
| Administrateur d'organisation curieux | Rôle légitime, tentative de lire les travaux des membres |
| Initié de la plateforme | Modérateur, administrateur, personne ayant accès à la console du fournisseur |
| Contributeur de contenu illicite | Soumission de fichiers sans droits ou malveillants |
| Source externe compromise ou hostile | Métadonnées, URL et documents piégés |
| Attaquant de la chaîne logicielle | Dépendance compromise, vol de secret de CI |

## 4. Frontières de confiance

```text
[Navigateur]  ── 1 ──>  [Next.js sur Vercel]  ── 2 ──>  [Supabase : PostgREST, Auth, Storage]
     │                          │                              │
     └────────── 3 ─────────────┼──────────────────────────────┘
                                │
                                ├── 4 ──> [Sources académiques externes]
                                ├── 5 ──> [Fournisseur IA]
                                └── 6 ──> [Envoi d'e-mails]

[Poste de développement, agents, CI]  ── 7 ──>  [Dépôt, Vercel, Supabase]
```

| # | Frontière | Point clé |
|---|---|---|
| 1 | Navigateur → serveur | Toute entrée est hostile ; une Server Action est un endpoint public |
| 2 | Serveur → Supabase | Session de l'utilisateur par défaut ; `service_role` par exception |
| 3 | Client quelconque → Supabase en direct | L'application n'emprunte pas ce chemin (ADR-0007), mais un attaquant le peut : la clé publique est connue de tous et **seule la base protège les données** |
| 4 | Serveur → sources externes | Les réponses et les URL sont des données non fiables |
| 5 | Serveur → fournisseur IA | Sortie de données ; contenu des documents non fiable |
| 6 | Serveur → e-mail | Liens d'invitation et de réinitialisation |
| 7 | Développement → production | Secrets, migrations, déploiements |

La frontière 3 est la plus importante : avec Supabase, un attaquant n'a pas besoin de
l'application pour interroger la base, l'authentification ou le stockage. Toute mesure
de ce document placée dans le code Next.js doit donc avoir son équivalent en base ou
dans la configuration de la plateforme (M-47).

## 5. Menaces

Gravité : **C** critique, **H** élevée, **M** moyenne, **L** faible, estimée sans mesure
en place. La colonne « Tâche » renvoie au backlog.

### 5.1 Identité et sessions

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-01 | Vol de compte par force brute ou réutilisation de mots de passe | H | Mesures configurées dans Supabase Auth, car l'API d'authentification est joignable sans l'application : CAPTCHA, limites de débit, confirmation de l'adresse, contrôle des mots de passe compromis ; MFA obligatoire pour les rôles privilégiés ; alerte de nouvelle connexion | Rafale de tentatives directement sur l'API d'authentification | B-10 |
| M-02 | Énumération des comptes à l'inscription, à la connexion, à la réinitialisation ou à l'invitation | M | Messages et temps de réponse identiques que le compte existe ou non, y compris sur l'API d'authentification appelée en direct | Comparaison des réponses | B-10 |
| M-03 | Vol de session par XSS ou stockage du jeton dans `localStorage` | H | Aucun client Supabase dans le navigateur (ADR-0007) ; cookies `HttpOnly`, `Secure`, `SameSite` posés par le serveur ; CSP stricte ; jeton d'accès de 10 minutes au plus ; rotation du jeton de rafraîchissement | Jeton inaccessible au JavaScript ; après déconnexion, plus aucun accès au-delà de la durée du jeton | B-08, B-10 |
| M-04 | Redirection ouverte dans les retours d'authentification | M | Liste blanche des URL de redirection, côté Supabase et côté application ; chemins relatifs uniquement | URL externe refusée | B-10 |
| M-05 | Élévation de privilège par `user_metadata`, modifiable par l'utilisateur | C | Aucune décision d'autorisation fondée sur `user_metadata` ; rôles lus en table | Un utilisateur qui s'ajoute `role: admin` n'obtient rien | B-09 |
| M-06 | CSRF sur une mutation ; clic détourné | M | `SameSite`, contrôle d'origine sur les mutations, aucune modification par GET, `frame-ancestors 'none'` | Requête inter-origine refusée | B-08 |

### 5.2 Autorisation et isolation

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-07 | Table exposée sans RLS, ou politique trop large, lue directement avec la clé publique | C | RLS activée dans la migration qui crée la table ; contrôle automatique en CI qui échoue si une table exposée n'a pas de RLS ou porte une politique `true` ; tests avec le rôle `anon` | Suite d'isolation ; contrôle CI | B-09 |
| M-08 | IDOR : accès au projet, à la note ou au fichier d'un autre par changement d'identifiant | C | RLS par appartenance ; identifiants non devinables ; même réponse pour interdit et inexistant | A / B sur chaque table et chaque endpoint | B-09 et suivantes |
| M-09 | Fuite entre organisations | H | `organization_id` contrôlé par `has_org_role` ; aucune requête multi-organisations ; exports et recherche filtrés | Organisation 1 / organisation 2 | B-09 |
| M-10 | Un administrateur d'organisation ou de plateforme lit les travaux privés | H | Aucun chemin d'accès par rôle vers les classes E, F, G, H, J (`authorization-model.md` §5.3, §6) | Tests « organisation ≠ projet », « administration ≠ contenu » | B-09 |
| M-11 | Déplacement de ligne : `update` qui change `owner_id`, `project_id` ou `organization_id` | H | `with check` sur chaque `update` ; colonnes de propriété protégées par droits par colonne ou trigger, un `with check` ne comparant pas ancienne et nouvelle valeur | Tentative de déplacement refusée | B-09 |
| M-12 | Affectation de masse : le client envoie `role`, `status`, `owner_id` | H | Droits par colonne en base ; transitions d'état par fonctions ; schémas de validation en liste blanche côté serveur en complément | Champ interdit refusé, y compris par appel direct à l'API | B-09, B-10 |
| M-13 | Fuite de `service_role` vers le navigateur, les logs ou un message d'erreur | C | Jamais de préfixe `NEXT_PUBLIC_` ; module serveur dédié marqué `server-only` ; contrôle du bundle client en CI ; rotation documentée | Recherche de la clé dans le bundle | B-08 |
| M-14 | Fonction `security definer` détournée (`search_path`, paramètre d'identité) | H | `search_path` fixé, schéma non exposé, identité lue par `auth.uid()`, `execute` retiré à `public`, `anon` et `authenticated` puis accordé fonction par fonction ; inventaire fermé (`authorization-model.md` §7.4, §7.5) | Revue de chaque fonction ; aucune fonction exécutable par `anon` | B-09 |
| M-15 | Abus d'une invitation : jeton deviné, transféré ou rejoué | H | Jeton aléatoire long, haché, usage unique, expiration ; par adresse : comparaison à l'adresse confirmée du compte ; par lien : aucun droit avant confirmation du propriétaire ; révocation | Rejeu refusé ; mauvaise adresse refusée ; lien seul sans lecture | Phase 4 |
| M-16 | Accès conservé après retrait d'un membre | M | Contrôle à chaque requête ; URL signées courtes ; aucun cache de contenu privé (voir M-51) | Lecture refusée après retrait | Phase 4 |

### 5.3 Entrées, contenu et fichiers

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-17 | XSS stockée par un titre, un résumé importé, un commentaire ou le contenu de l'éditeur | H | Échappement par défaut ; pas de HTML brut ; contenu riche stocké dans un format structuré, écrit uniquement par une fonction serveur qui le nettoie par liste blanche, et nettoyé de nouveau à l'affichage ; CSP sans script inline | Charges XSS dans chaque champ, y compris par import | B-08, B-13, Phase 3 |
| M-18 | URL dangereuse dans une ressource (`javascript:`, `data:`) | M | Schémas `http` et `https` uniquement, imposés par une contrainte de base ; liens externes en `rel="noopener noreferrer"` | URL `javascript:` refusée | B-13 |
| M-19 | Injection SQL ou abus des opérateurs de recherche | H | Requêtes paramétrées ; pas de SQL construit par concaténation, y compris dans les fonctions ; opérateurs limités ; longueur bornée | Charges d'injection ; requêtes pathologiques | B-16 |
| M-20 | Téléversement malveillant : exécutable, fichier piégé, type falsifié, nom avec traversée de chemin | H | Buckets privés avec limites de taille et de type au niveau du bucket ; type réel vérifié côté serveur ; chemin généré par le serveur ; table `files` avec `scan_status` : aucun tiers ne lit un fichier non analysé ; aucun accès direct à `storage.objects` ; service avec `Content-Disposition: attachment` et `nosniff` | Fichier renommé, surdimensionné, nom `../` | Phase 2 |
| M-21 | Fichier privé exposé : bucket public, URL permanente, accès console | C | Aucun bucket public pour du contenu utilisateur ; aucune politique sur `storage.objects` pour `anon` et `authenticated` ; URL signées courtes émises après contrôle de la ligne `files`, avec ligne d'audit ; accès console limité, MFA, tracé | Téléchargement authentifié direct refusé ; URL expirée refusée | Phase 2, B-08 |
| M-22 | SSRF par la vérification de liens ou l'import d'une URL soumise | H | Résolution DNS contrôlée ; refus des adresses privées, locales et de métadonnées cloud ; pas de suivi de redirection vers ces adresses ; ports et schémas limités ; délai et taille bornés | URL vers `169.254.169.254`, `localhost`, redirection interne | B-15, Phase 2 |
| M-23 | Import piégé (BibTeX, RIS, CSV, métadonnées de connecteur) : volume, profondeur, contenu actif | M | Analyseurs bornés ; validation par schéma ; mêmes règles de nettoyage que la saisie | Fichiers géants ou malformés | Phase 2 |
| M-24 | Injection dans les exports : formules dans un CSV, HTML ou ressources distantes dans un PDF ou un DOCX | M | Neutralisation des cellules commençant par `= + - @` ; génération sans chargement de ressource distante ; pas de rendu de HTML utilisateur brut | Export d'une charge connue | Phase 3 |

### 5.4 Catalogue et droit d'auteur

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-25 | Publication d'un document sans droit, ou d'une licence fausse | H | Contrainte en base : pas de `published` sans provenance, licence et statut d'accès ; preuve d'autorisation conservée ; modération humaine ; procédure de retrait rapide | Publication incomplète refusée | B-13, B-14, B-05 |
| M-26 | Ingestion contraire aux conditions d'une source | H | Liste fermée de sources autorisées ; champs autorisés seulement ; quotas respectés ; pas de contournement de paywall | Revue de chaque connecteur | B-06, B-15 |
| M-27 | Empoisonnement du catalogue : soumissions en masse, faux signalements, métadonnées trompeuses | M | Limitation de débit ; rien n'est publié automatiquement ; dédoublonnage ; séparation des tâches de modération | Soumission en rafale limitée | B-14 |
| M-28 | Contenu privé dans la recherche publique | C | La recherche ne lit que `published` public ; aucune table privée dans une vue ou un index de recherche ; effet immédiat d'un retrait | Recherche d'un terme présent seulement dans un projet privé | B-16 |

### 5.5 Assistance IA

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-29 | Envoi d'un mémoire privé à un fournisseur externe sans consentement | C | Consentement par projet, enregistré, vérifié côté serveur avant chaque appel ; mode sans traitement externe ; contrat interdisant la réutilisation et bornant la conservation | Appel refusé sans consentement | Phase 6, B-05 |
| M-30 | Injection de prompt par un document importé ou partagé | H | Document traité comme donnée ; instructions, contenu et métadonnées séparés ; aucun outil ni action déclenchable ; sortie nettoyée comme une entrée utilisateur | Corpus de documents piégés | Phase 6 |
| M-31 | Source, DOI ou citation inventés | H | Réponses limitées aux sources fournies ; identifiants et passages conservés ; vérification d'existence d'un DOI avant affichage ; message d'absence de source ; validation humaine | Question sans source disponible | Phase 6 |
| M-32 | Fuite de contenu privé par les journaux d'appels IA, ou entre utilisateurs par un cache | H | Aucun contenu dans les journaux ; pas de cache partagé de réponses ; contexte strictement limité au projet de l'appelant | Inspection des journaux ; A / B | Phase 6 |
| M-33 | Explosion des coûts IA | M | Quotas par utilisateur et par organisation ; plafond global ; alerte | Dépassement de quota refusé | Phase 6 |

### 5.6 Disponibilité et abus

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-34 | Abus d'API : extraction du catalogue, pagination ou filtres abusifs, requêtes coûteuses | M | Nombre maximal de lignes par réponse et délai d'exécution par rôle fixés côté base ; pagination plafonnée ; taille de requête bornée ; limitation de débit ; pare-feu applicatif | Page de 100 000 lignes refusée | B-08, B-16 |
| M-35 | Abus des envois : e-mails d'invitation ou de réinitialisation en masse | M | Limites d'envoi configurées dans Supabase Auth et en base pour les invitations ; pas de contenu libre dans les e-mails | Envois en rafale limités | B-10, Phase 4 |
| M-36 | Perte de données : suppression, rançongiciel, erreur de migration | C | Sauvegardes gérées et restauration à un instant donné ; **en plus**, copie chiffrée hors plateforme de la base **et des buckets**, à rétention verrouillée, car les sauvegardes gérées ne couvrent pas les fichiers et disparaissent avec le projet ; compte du fournisseur protégé par MFA avec un nombre limité de propriétaires ; migrations rejouées en CI ; pas de migration destructive sans approbation ; suppression logique des projets avec délai | Exercice de restauration de la base et des fichiers | B-08, avant production |

### 5.7 Journalisation et vie privée

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-37 | Données sensibles dans les journaux ou les messages d'erreur | H | Journalisation structurée avec liste blanche de champs ; aucun corps de requête, jeton ni contenu ; erreurs génériques vers le client | Recherche de marqueurs dans les journaux | B-08 |
| M-38 | Journal d'audit altéré ou incomplet | H | Table en ajout seul ; écriture par le système ; aucune politique `update` ou `delete` ; export régulier hors base | Modification refusée, y compris pour un administrateur | B-09 |
| M-39 | Profil exposé par défaut ; données de mineurs | H | Aucun champ public par défaut ; collecte minimale ; décision sur les mineurs avant ouverture ; analyse juridique par pays | Profil neuf invisible pour un tiers | B-11, B-05 |
| M-40 | Contenu privé resté dans le navigateur : cache du service worker, stockage local | M | Pas de cache partagé de réponses authentifiées ; chiffrement du hors-ligne ; effacement à la déconnexion | Inspection après déconnexion | Phase 5 |

### 5.8 Chaîne de développement et de déploiement

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-41 | Secret commité | H | `.gitignore` (fait) ; scan de secrets en pre-commit et en CI ; `.env.example` sans valeur ; rotation immédiate en cas de fuite | Commit d'un faux secret bloqué | B-08 |
| M-42 | Dépendance compromise ou vulnérable | H | Lockfile versionné ; `npm ci` en CI ; audit des dépendances bloquant sur élevé et critique ; mises à jour suivies ; ajout de dépendance justifié | CI en échec sur une vulnérabilité connue | B-08 |
| M-43 | Déploiement ou migration non revus en production | H | Branche `main` protégée ; revue obligatoire ; production déployée par la CI seulement ; secrets de production absents des postes | Push direct refusé | B-08 |
| M-44 | Agent de développement qui exécute une action destructrice ou lit un secret | M | Règles `deny` de `.claude/settings.json` ; agent sécurité en lecture seule ; aucun identifiant de production sur le poste ; revue humaine avant fusion | Revue périodique des réglages | B-07 (fait) |
| M-45 | Prévisualisations exposées avec des données réelles | M | Prévisualisations reliées au projet de staging uniquement ; protection des déploiements de prévisualisation ; aucune donnée de production hors production | Vérification des variables par environnement | À la liaison du projet Vercel |
| M-46 | En-têtes de sécurité absents | M | CSP, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors` ; CORS limité aux origines connues | Contrôle automatique des en-têtes | B-08 |

### 5.9 Contournement de l'application et plateforme

| ID | Menace | Grav. | Mesures exigées | Test | Tâche |
|---|---|---|---|---|---|
| M-47 | Contournement de l'application par appel direct à PostgREST, Auth ou Storage avec un jeton valide : validation, nettoyage, pagination, limitation de débit et audit évités | H | ADR-0007 : aucune règle de sécurité portée par le seul code Next.js ; contraintes, droits par colonne et triggers en base ; écritures sensibles par fonctions nommées ; droits d'écriture directe retirés ; audit écrit par la base | Chaque interdiction testée par appel direct à l'API avec le jeton de l'acteur | B-08, B-09 |
| M-48 | Rétrogradation du MFA : session `aal1` d'un compte privilégié, ou facteur désenrôlé | H | Les fonctions de rôle exigent `aal2` pour `moderator`, `platform_admin`, `super_admin`, `org_admin` ; désenrôlement soumis à une session `aal2` récente et notifié | Modérateur en `aal1` sans droit de modération | B-09, B-10 |
| M-49 | Jeton encore valide après suspension du compte, retrait de rôle ou déconnexion | M | État du compte et rôles lus en table à chaque requête, jamais dans le jeton ; jeton d'accès de 10 minutes au plus ; opérations privilégiées vérifiées par `getUser()` | Compte suspendu sans droit avant l'expiration du jeton | B-09, B-10 |
| M-50 | Surface Supabase laissée par défaut : Realtime (événements non filtrés), API GraphQL, fonctions de `public` exécutables par `anon`, connexions anonymes, vues matérialisées, trigger recopiant `raw_user_meta_data` | H | Configuration fermée (`authorization-model.md` §7.6) ; privilèges par défaut révoqués dans la première migration ; contrôle CI des schémas exposés, des tables sans RLS et des fonctions exécutables | Contrôle CI ; appel `anon` à chaque fonction | B-09 |
| M-51 | Réponse authentifiée servie à un autre utilisateur par un cache (cache de données Next.js, régénération statique, CDN) | H | Rendu dynamique et `Cache-Control: no-store` sur toute route authentifiée ; aucune mise en cache de requête faite sous une session ; seules les pages publiques du catalogue sont mises en cache | A puis B sur la même URL ; en-têtes vérifiés automatiquement | B-08 |
| M-52 | Sur-exposition par sérialisation : un composant serveur transmet au client un objet complet (champs internes, adresses) | M | Objets de transfert en liste blanche ; sélection explicite des colonnes ; modules d'accès aux données marqués `server-only` | Inspection de la charge utile des pages | B-08 et suivantes |
| M-53 | Autorisation reposant sur le seul middleware, contourné par une route ou une action non couverte | H | Contrôle d'identité et d'autorisation dans chaque Route Handler et chaque Server Action ; le middleware ne fait que rafraîchir la session et rediriger | Appel direct de chaque action sans session | B-08, B-10 |
| M-54 | Connexion PostgreSQL directe exposée, ou identifiant de migration de la CI volé | H | Restrictions réseau sur la connexion directe ; rôle de migration distinct du rôle applicatif et de `service_role` ; secret de CI limité à l'environnement de production protégé ; rotation | Connexion depuis une adresse non autorisée refusée | B-08, avant production |
| M-55 | Métadonnées sensibles dans un fichier publié : auteur, commentaires, suivi des modifications | M | Nettoyage des métadonnées avant publication ; avertissement au contributeur | Fichier témoin publié puis inspecté | Phase 2 |
| M-56 | Coûts de stockage et de trafic par téléversements ou téléchargements massifs | M | Quotas par utilisateur et par organisation ; limites au niveau du bucket ; alertes de consommation | Dépassement de quota refusé | Phase 2 |

## 6. Couverture du cahier §17

| Menace du cahier | Identifiants |
|---|---|
| Vol de compte | M-01, M-02, M-03, M-04, M-48, M-49 |
| IDOR | M-07, M-08, M-11, M-12, M-47, M-53 |
| Upload malveillant | M-20, M-21 |
| XSS | M-03, M-17, M-18 |
| Fuite de mémoire privé | M-08, M-10, M-21, M-28, M-29, M-32, M-40, M-51 |
| Abus d'API | M-33, M-34, M-35, M-47, M-56 |
| Source illégale | M-25, M-26, M-27 |
| Hallucination IA | M-31 |
| Prompt injection | M-30 |
| Ransomware / perte de données | M-36 |

## 7. Priorités

Les menaces critiques conditionnent l'ordre du backlog.

| Rang | Menaces | Conséquence sur le plan |
|---|---|---|
| 1 | M-07, M-05, M-13, M-47, M-50 | Le socle (B-08) a livré le contrôle du bundle client et des secrets ; le schéma de fondation (B-09) livre le contrôle CI de la RLS et des fonctions exposées, la configuration fermée, les fonctions de rôle et la suite d'isolation par appel direct, avant toute table métier |
| 2 | M-08, M-10, M-11, M-48, M-51, M-53 | Aucune table n'est fusionnée sans ses tests A / B et inter-organisations ; aucune route authentifiée sans `no-store` ni contrôle propre |
| 3 | M-28 | Le test « terme privé introuvable » accompagne la première version de la recherche |
| 4 | M-21, M-20 | Aucun bucket créé avant la table `files`, les URL signées et l'analyse des fichiers |
| 5 | M-36, M-54 | Copie hors plateforme et exercice de restauration, base et fichiers, avant toute mise en production |
| 6 | M-29 | Aucun appel IA externe avant le mécanisme de consentement |

## 8. Risques résiduels connus

| Risque | Raison | Traitement |
|---|---|---|
| Accès du fournisseur et des administrateurs techniques à la base | Inhérent à un hébergement géré | Accès minimal, MFA, traçabilité ; chiffrement applicatif des contenus à étudier si le risque l'exige |
| Un encadreur légitime copie un travail | L'accès en lecture est le but du partage | Journal des accès et des téléchargements ; versions horodatées comme preuve d'antériorité |
| Capture d'écran ou copie manuelle d'un contenu partagé | Non contrôlable techniquement | Information de l'utilisateur avant le partage |
| Exactitude des métadonnées issues de sources externes | Dépend des sources | Provenance affichée, date de vérification, signalement |
| Conformité juridique par pays | Analyse non réalisée | B-05 ; avis juridique avant lancement |
| Antivirus sur les fichiers | Solution non choisie | Décision à prendre avant la Phase 2 |
| Pas de temps réel côté navigateur | Conséquence d'ADR-0007 | À réétudier en Phase 4 par un ADR dédié |
| Comportements de Supabase supposés (cookies de session `HttpOnly`, filtrage Realtime, périmètre des sauvegardes) | Issus de la connaissance de la plateforme, non vérifiés sur la documentation à jour | À vérifier en B-08 et B-10 avant de figer la configuration |

## 9. Révision

Ce document est révisé :

- avant la première migration, avec le schéma réel ;
- à l'ajout de chaque surface : téléversement, connecteur, export, partage, IA, mobile ;
- après tout incident ;
- avant la mise en production, avec les résultats des tests et d'un contrôle dynamique
  sur l'environnement de staging (cahier §16.4).
