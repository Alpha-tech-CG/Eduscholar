# Architecture actuelle

**Date du constat :** 5 octobre 2026

## Ce qui existe

Il n'y a pas d'architecture logicielle : le dépôt ne contient aucun code. La seule
architecture en place est celle de l'orchestration des agents.

```text
eduscholar/
├── AGENTS.md                                   règles communes à tous les agents
├── CLAUDE.md                                   rôle et méthode de l'orchestrateur
├── .claude/
│   ├── settings.json                           permissions allow / ask / deny
│   └── agents/
│       ├── orchestrator.md
│       ├── database-engineer.md
│       ├── backend-engineer.md
│       ├── frontend-engineer.md
│       ├── qa-engineer.md
│       └── security-reviewer.md
└── docs/
    ├── EDUSCHOLAR_CAHIER_DES_CHARGES_COMPLET.md    référence produit
    ├── current-state.md
    ├── backlog.md
    ├── architecture/current-architecture.md
    ├── security/initial-audit.md
    ├── handoffs/                               vide
    ├── product/                                vide
    └── reports/                                vide
```

## Orchestration

- L'orchestrateur (session principale, `CLAUDE.md`) analyse, planifie, délègue et vérifie.
- Ordre de livraison défini dans `orchestrator.md` : schéma et migration, types partagés,
  contrat API, backend, frontend, tests, revue sécurité, documentation.
- Une vulnérabilité CRITICAL ou HIGH relevée par `security-reviewer` bloque la validation.
- Les modifications de fichiers et les commandes sensibles passent par une demande de
  confirmation (`ask` dans `settings.json`).

## Ce qui n'existe pas

| Couche (cahier §9) | État |
|---|---|
| `apps/web` | Absent |
| `apps/mobile` | Absent |
| `apps/api` | Absent |
| PostgreSQL, migrations, RLS | Absent |
| Stockage objet privé | Absent |
| Moteur de recherche | Absent |
| Cache, file de tâches | Absent |
| Connecteurs (OpenAlex, CORE, Crossref, DOAJ) | Absent |
| CI/CD, environnements | Absent |
| Observabilité, audit | Absent |

## Architecture cible

Elle est décrite au §9 du cahier des charges, qui laisse ouverts les choix suivants.
Aucun n'est tranché à ce jour.

| Décision | Options citées ou implicites | Impact |
|---|---|---|
| Structure du dépôt | Monorepo `apps/*` + `packages/*` | Outillage, CI |
| Framework web | « Next.js ou équivalent » | Rendu, SEO, PWA |
| Backend | API séparée (`apps/api`) ou routes du framework web | Déploiement, autorisation |
| Données et autorisation | Supabase (RLS native) ou PostgreSQL + Prisma (autorisation applicative) | Modèle de sécurité entier |
| Authentification | Fournisseur d'identité éprouvé, à choisir | Sessions, MFA |
| Recherche | Recherche plein texte PostgreSQL ou moteur dédié | Index public / privé |
| File de tâches | À choisir | Import, export, OCR |
| Hébergement | À choisir (plugin Vercel installé, non lié) | Environnements, secrets |
| Internationalisation | Bibliothèque à choisir, fr et en dès le départ | Tous les composants |
| Mobile | PWA d'abord, React Native / Expo ensuite | Périmètre du MVP |

Mise à jour du 6 octobre 2026 : ces choix sont tranchés par ADR-0001 à ADR-0006
(Next.js, Supabase avec RLS, monorepo npm workspaces, backend dans Next.js, recherche
plein texte PostgreSQL, `next-intl`, Vercel). Restent ouverts : file de tâches et
outillage de test.

## Mise à jour du 6 octobre 2026 — socle technique

```text
eduscholar/
├── package.json            workspaces et scripts communs
├── apps/web/               application Next.js
│   ├── messages/           catalogues fr et en
│   ├── src/proxy.ts        routage par langue et CSP avec nonce
│   ├── src/i18n/           configuration next-intl
│   ├── src/lib/security/   en-têtes de sécurité
│   ├── src/app/[locale]/   pages
│   ├── tests/              tests unitaires (Vitest)
│   └── e2e/                tests de bout en bout (Playwright)
├── scripts/                contrôles : secrets, bundle client, audit
├── security/               exceptions d'audit datées
├── .githooks/              pre-commit
└── .github/workflows/      CI
```

Toutes les pages sont rendues dynamiquement, conséquence de la CSP avec nonce (ADR-0008).
Les couches données, authentification, recherche et stockage restent absentes.

## Contraintes d'architecture déjà fixées

Issues d'`AGENTS.md`, de `CLAUDE.md` et du cahier ; elles s'imposent quel que soit le choix
de stack :

- autorisation vérifiée côté serveur à chaque requête ;
- projets de recherche privés par défaut ;
- aucune donnée privée dans l'index de recherche public ;
- tout changement de schéma par migration versionnée ;
- fichiers privés servis par URL signée à durée courte ;
- provenance et licence obligatoires pour toute ressource publiée ;
- aucun envoi de document privé à un fournisseur IA sans consentement ;
- pays, langues, fuseaux et devises jamais codés en dur ;
- français et anglais dès la première interface.
