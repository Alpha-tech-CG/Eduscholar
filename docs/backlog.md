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
| B-09 | Schéma de fondation : profils, organisations, membres, journal d'audit, avec politiques d'accès et tests d'isolation | database-engineer, security-reviewer | B-02, B-03, B-08 | Migration versionnée, tests utilisateur A / B et organisation A / B verts | à faire |
| B-10 | Authentification : inscription, connexion, déconnexion, réinitialisation, sessions | backend-engineer, frontend-engineer, qa-engineer, security-reviewer | B-08, B-09 | Messages d'erreur génériques, cookies sécurisés, limitation de débit, tests verts | à faire |

## Phase 1 — MVP recherche

| ID | Tâche | Dépend de | Statut |
|---|---|---|---|
| B-11 | Profil académique (pays, niveau, filière, langue, confidentialité par défaut) | B-10 | à faire |
| B-12 | Référentiels : pays, langues, niveaux, filières, matières | B-06, B-09 | à faire |
| B-13 | Schéma du catalogue : ressources, sources, licences, tags, statuts d'accès et éditoriaux | B-09 | à faire |
| B-14 | Administration et modération : vérifier, publier, retirer une ressource, avec audit | B-13 | à faire |
| B-15 | Import manuel et premier connecteur (OpenAlex ou Crossref) | B-13, B-06 | à faire |
| B-16 | Recherche avec au moins trois filtres, fiche ressource avec origine et statut d'accès | B-13 | à faire |
| B-17 | Favoris et collections privées | B-13 | à faire |

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
| Créer un compte et choisir sa filière | B-10, B-11 | non couvert |
| Rechercher avec au moins trois filtres | B-16 | non couvert |
| Origine et statut d'accès affichés | B-13, B-16 | non couvert |
| Vérifier, publier, retirer une ressource | B-14 | non couvert |
| Collection privée | B-17 | non couvert |
| Projet de recherche privé | Phase 3 | non couvert |
| Sources et fiches de lecture | Phase 3 | non couvert |
| Bibliographie sans source inventée | Phase 3 | non couvert |
| Export du projet | Phase 3 | non couvert |
| Pas d'accès sans partage explicite | B-09, Phase 3 | non couvert |
| Pas d'URL publique permanente pour un fichier privé | Phase 3 | non couvert |
| Actions sensibles auditables | B-09, B-14 | non couvert |
| Sauvegardes restaurables en test | À planifier | non couvert |
