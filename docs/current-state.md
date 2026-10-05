# État actuel du projet EduScholar

**Date du constat :** 5 octobre 2026
**Méthode :** inspection en lecture seule du dépôt `D:\Eduweb\eduscholar`
**Phase :** tout début de la Phase 0 (Fondation) du cahier des charges

## Résumé

Le dépôt contient la gouvernance des agents et le cahier des charges. Il ne contient
aucun code applicatif, aucune base de données, aucun test et aucun dépôt Git.

## Inventaire

| Chemin | Contenu |
|---|---|
| `AGENTS.md` | 16 règles obligatoires, règles de base de données, format de fin de tâche |
| `CLAUDE.md` | Rôle d'orchestrateur, méthode en 13 étapes, délégation, format de rapport |
| `docs/EDUSCHOLAR_CAHIER_DES_CHARGES_COMPLET.md` | Cahier des charges v1.0 (déplacé de la racine vers `docs/` le 5 octobre 2026) |
| `.claude/settings.json` | Permissions `allow` / `ask` / `deny` |
| `.claude/agents/` | 6 agents (voir ci-dessous) |
| `docs/architecture`, `handoffs`, `product`, `reports`, `security` | Dossiers créés, vides avant cet audit |

## Agents disponibles

| Agent | Outils | Remarque |
|---|---|---|
| `orchestrator` | Read, Grep, Glob, Edit, Write, Bash | Reprend le rôle décrit dans `CLAUDE.md` |
| `database-engineer` | Read, Grep, Glob, Edit, Write, Bash | |
| `backend-engineer` | Read, Grep, Glob, Edit, Write, Bash | |
| `frontend-engineer` | Read, Grep, Glob, Edit, Write, Bash | |
| `qa-engineer` | Read, Grep, Glob, Edit, Write, Bash | |
| `security-reviewer` | Read, Grep, Glob, Bash | Pas d'Edit/Write, mais Bash permet d'écrire |

Les six fichiers ont un frontmatter valide (`name`, `description`, `tools`) et sont
reconnus par Claude Code.

Agents prévus par `CLAUDE.md` (section Délégation) mais absents :

- recherche et ingestion de contenu ;
- IA documentaire ;
- mobile et offline.

## Cohérence AGENTS.md / CLAUDE.md

Aucune contradiction de fond : les règles de sécurité, de confidentialité et de
non-invention de sources sont alignées. Écarts relevés :

| # | Écart | Conséquence |
|---|---|---|
| 1 | ~~`CLAUDE.md` et `orchestrator.md` cherchent le cahier des charges dans `docs/` ; il est à la racine~~ | Levé : le cahier est désormais dans `docs/` |
| 2 | `CLAUDE.md` cite 8 domaines de délégation ; 5 agents spécialisés existent | 3 domaines sans agent |
| 3 | Trois formats de rapport différents : `AGENTS.md` (7 points), `CLAUDE.md` (9 sections), `orchestrator.md` (7 sections) | Rapports hétérogènes |
| 4 | `orchestrator.md` duplique `CLAUDE.md` avec des variantes (ordre de livraison, vérification Git, lecture des scripts) | Deux sources de vérité à maintenir |
| 5 | `CLAUDE.md` exige lint, typecheck et tests ; `AGENTS.md` n'exige que des tests | Mineur |
| 6 | `AGENTS.md` impose la migration pour tout changement de base ; aucun outil de migration n'est choisi | Règle inapplicable pour l'instant |

## Stack réelle

Aucune. Constat factuel :

- pas de `package.json`, pas de lockfile, pas de `node_modules` ;
- pas de dossier `apps/`, `packages/`, `src/`, `supabase/` ou `prisma/` ;
- pas de configuration TypeScript, ESLint, test ou CI ;
- pas de `Dockerfile`, pas d'infrastructure déclarative.

Outils présents sur le poste : Node.js 24.15.0, npm 11.12.1, Git 2.54.0.

`.claude/settings.json` mentionne à la fois `npx prisma migrate` et `supabase db push` :
le choix de la couche de données n'est pas tranché.

## Scripts lint, typecheck et tests

Aucun script n'existe. Les commandes `npm run lint`, `npm run typecheck`, `npm test` et
`npm run test:e2e` sont autorisées dans `.claude/settings.json` mais échoueraient faute
de `package.json`.

## Environnements

- Aucun fichier `.env`, `.env.example` ou `.env.*`.
- Aucun environnement défini (local, test, staging, production).
- Aucune liste des variables attendues.
- Le serveur MCP Vercel est installé mais non authentifié ; aucun projet Vercel lié.

## Secrets

- Aucun secret trouvé dans les fichiers du dépôt (recherche par motifs : clés,
  tokens, mots de passe, clés privées, JWT).
- Pas de dépôt Git, donc pas de `.gitignore` : rien n'est exclu aujourd'hui.
- `.claude/settings.json` interdit la lecture et l'écriture de `.env` et `.env.*` via
  les outils Read, Edit et Write, à la racine seulement.

Détail dans `docs/security/initial-audit.md`.

## Écart avec le cahier des charges

- Critères d'acceptation du MVP (§20) : 0 sur 13.
- Checklist « Avant le code » (§22) : 0 sur 7.
- Phase 0 (§18) : aucun livrable.

## Mise à jour du 6 octobre 2026 — socle technique

- Monorepo npm workspaces ; `apps/web` en Next.js 16.3, React 19.2, TypeScript strict,
  Tailwind CSS 4, next-intl 4 (français et anglais).
- Scripts à la racine : `dev`, `lint`, `typecheck`, `test`, `build`, `test:e2e`,
  `check:secrets`, `check:audit`, `check:bundle`.
- 19 tests de scripts, 14 tests unitaires, 34 tests de bout en bout (bureau et mobile).
- CSP stricte avec nonce, en-têtes de sécurité, contrôle de secrets en pre-commit.
- Toujours aucune base de données, aucune authentification, aucune fonctionnalité métier.
- CI écrite, jamais exécutée : il n'existe pas de dépôt distant.

## Problèmes bloquants

Mise à jour du 6 octobre 2026 : les points 1 et 2 sont levés (Git initialisé ;
Next.js + Supabase retenus, voir `docs/architecture/adr-0001-nextjs-supabase.md`).
Les écarts 2, 3 et 4 de cohérence sont levés (9 agents, format de rapport unique dans
`AGENTS.md`, `CLAUDE.md` et `AGENTS.md` déclarés source de vérité). Le reste de ce
document décrit l'état constaté le 5 octobre.

1. ~~Pas de dépôt Git.~~
2. ~~Stack non décidée.~~
3. Modèle d'autorisation et modèle multi-tenant non écrits.
4. Aucune chaîne de qualité (lint, typecheck, tests, CI).

Voir `docs/backlog.md` pour l'ordre de traitement.
