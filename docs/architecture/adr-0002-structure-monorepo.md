# ADR-0002 — Monorepo npm workspaces

**Date :** 6 octobre 2026
**Statut :** accepté (validé par le porteur de projet)
**Tâche :** B-02

## Contexte

Le cahier (§9) prévoit plusieurs applications (web, mobile, API) et du code partagé
(types, design system, i18n). Le principe produit n° 7 demande des modules qui évoluent
séparément.

## Décision

Un seul dépôt, organisé en npm workspaces :

```text
apps/web        application Next.js
packages/*      code partagé (types, validation, interface, configuration)
supabase/       migrations SQL, configuration locale, tests RLS
docs/           documentation
```

`apps/mobile` sera ajouté en Phase 5. Aucun `apps/api` pour le MVP (voir ADR-0003).

## Règles

- Un package n’est créé que lorsqu’il a au moins deux consommateurs ou une frontière nette.
- Les scripts `lint`, `typecheck`, `test` et `build` existent à la racine et couvrent tous les workspaces.
- Un seul lockfile, versionné.

## Conséquences

- Positif : types et schémas de validation partagés, une seule CI, pas d’outil supplémentaire.
- Négatif : npm workspaces n’a pas de cache de build ; un orchestrateur de tâches pourra être ajouté si les temps de CI le justifient.

## Alternative écartée

Dépôts séparés par application : contrats dupliqués et versions à synchroniser, sans bénéfice à cette taille.
