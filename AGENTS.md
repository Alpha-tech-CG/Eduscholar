# AGENTS.md

## Projet

EduScholar est une plateforme mondiale de recherche académique,
de bibliothèque numérique et d'accompagnement à la rédaction.

## Règles obligatoires

1. Lire le cahier des charges avant toute modification.
2. Inspecter le code existant avant de créer un nouveau module.
3. Ne jamais réécrire toute l'application sans audit préalable.
4. Ne jamais mettre de secret dans le dépôt.
5. Ne jamais faire confiance aux données envoyées par le frontend.
6. Toute autorisation doit être vérifiée côté backend.
7. Toute modification de base de données doit passer par une migration.
8. Toute fonctionnalité doit avoir des tests.
9. Toute donnée privée doit être protégée par des permissions explicites.
10. Ne jamais indexer les projets privés dans la recherche publique.
11. Ne jamais inventer de source, citation, auteur ou DOI.
12. Ne jamais envoyer un document privé à un fournisseur IA sans consentement.
13. Toute modification critique doit être revue par l'agent sécurité.
14. Ne jamais supprimer une donnée de production directement.
15. Préserver le support français et anglais.
16. Prévoir les petits écrans et les connexions faibles.

## Références

- Cahier des charges : `docs/EDUSCHOLAR_CAHIER_DES_CHARGES_COMPLET.md`.
- Décisions d'architecture : `docs/architecture/adr-*.md`. Elles s'imposent à tous les agents ;
  une décision ne se change que par un nouvel ADR validé par le porteur de projet.
- État et priorités : `docs/current-state.md`, `docs/backlog.md`.
- Sécurité : `docs/security/`.

## Stack retenue

- Monorepo npm workspaces : `apps/web`, `packages/*`, `supabase/`.
- Next.js (App Router), TypeScript strict.
- Supabase : PostgreSQL, Auth, Storage, RLS. Prisma n'est pas utilisé.
- Migrations SQL versionnées dans `supabase/migrations/`.
- `next-intl` pour le français et l'anglais.
- Vercel pour le web, Supabase hébergé pour les données.
- Tailwind CSS, Vitest, Playwright (ADR-0008).
- Le navigateur n'appelle jamais Supabase (ADR-0007).

## Agents

| Agent | Domaine |
|---|---|
| `orchestrator` | planification et coordination |
| `database-engineer` | base de données et RLS |
| `backend-engineer` | backend et API |
| `frontend-engineer` | frontend et UX |
| `content-ingestion-engineer` | recherche et ingestion de contenu |
| `security-reviewer` | sécurité, en lecture seule |
| `qa-engineer` | QA et tests |
| `document-ai-engineer` | IA documentaire |
| `mobile-offline-engineer` | mobile et offline |

## Règles de base de données

- Toutes les tables privées doivent disposer de politiques d'accès.
- Les migrations doivent être versionnées.
- Les contraintes, index et relations doivent être documentés.
- Les tests d'isolation entre utilisateurs et organisations sont obligatoires.
- Les projets de recherche sont privés par défaut.
- La RLS est activée sur toute table exposée, avec une politique explicite par opération.
- La clé `service_role` reste côté serveur ; son usage est limité et audité.

## Commandes

À lancer depuis la racine avant de déclarer une tâche terminée :

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e` (après le build)
- `npm run check:secrets` et `npm run check:audit`

Dans `apps/web`, lire la documentation embarquée de Next.js
(`node_modules/next/dist/docs/`) avant d'écrire du code : la version installée diffère
des versions antérieures (voir `apps/web/AGENTS.md`).

## Règles de fin de tâche

Tout agent, orchestrateur compris, termine par ce rapport, dans cet ordre. C'est le seul
format de rapport du projet. Une section sans objet est conservée avec la mention « Aucun ».

```text
## Résumé            ce qui a été fait et les décisions prises
## Fichiers modifiés
## Migrations
## API et contrats
## Tests exécutés    commandes lancées et résultat réel ; dire ce qui n'a pas été exécuté
## Revue sécurité    risques de sécurité introduits, levés ou constatés
## Documentation
## Risques restants  problèmes non résolus
## Prochaine tâche   prochaine action recommandée
```

Un agent spécialisé peut ajouter après ce rapport les éléments propres à son domaine.
