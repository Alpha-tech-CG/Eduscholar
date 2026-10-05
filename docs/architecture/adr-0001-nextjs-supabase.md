# ADR-0001 — Next.js et Supabase comme socle web et données

**Date :** 6 octobre 2026
**Statut :** accepté (validé par le porteur de projet)
**Tâche :** B-02

## Contexte

Le cahier des charges laisse ouverts le framework web (« Next.js ou équivalent », §9.1) et
la couche de données (« si PostgreSQL/Supabase est utilisé », §12.3). `.claude/settings.json`
citait à la fois Prisma et Supabase. Le modèle de sécurité dépend de ce choix : il devait
être tranché avant toute migration.

Exigences déterminantes :

- RLS sur toutes les tables exposées, avec politiques explicites par opération (§12.3) ;
- projets de recherche privés par défaut, isolation entre utilisateurs et organisations ;
- fichiers privés servis par URL signée à durée courte (§11.4) ;
- authentification par un fournisseur éprouvé, MFA pour administrateurs et encadreurs (§10.2) ;
- pages publiques référençables, PWA, français et anglais (§6.1, §14).

## Décision

1. **Web :** Next.js (App Router) en TypeScript strict.
2. **Données :** Supabase — PostgreSQL, Auth, Storage — avec la RLS comme barrière
   d'autorisation principale.
3. **Migrations :** fichiers SQL versionnés dans `supabase/migrations/`, appliqués par la
   CLI Supabase. Prisma n'est pas utilisé.

## Règles qui en découlent

- La RLS est activée sur toute table du schéma exposé, sans exception. Aucune politique
  `using (true)` sur une table privée.
- La clé `service_role` contourne la RLS : elle reste côté serveur, n'est jamais préfixée
  `NEXT_PUBLIC_`, et son usage est limité à des opérations nommées et auditées
  (modération, tâches d'import, administration).
- Les requêtes faites au nom d'un utilisateur utilisent sa session, jamais `service_role`.
- La RLS ne dispense pas de la validation des entrées ni des contrôles métier côté serveur.
- Les buckets Storage sont privés par défaut ; l'accès passe par des URL signées courtes.
- Le développement se fait sur une instance Supabase locale ou un projet de développement
  dédié. Aucun identifiant de production sur le poste de développement.
- Chaque migration est accompagnée de tests d'isolation (utilisateur A / B, organisation A / B).

## Conséquences

- Positif : RLS, authentification et stockage privé disponibles sans les construire ;
  un seul modèle d'autorisation, au plus près des données.
- Négatif : dépendance à un fournisseur ; les politiques RLS doivent être testées avec
  rigueur, une politique erronée expose directement les données.
- Réversibilité : la base reste du PostgreSQL standard ; les migrations SQL sont portables.

## Alternative écartée

PostgreSQL + Prisma avec autorisation dans le code backend : contrôle plus fin dans le
code, mais authentification, stockage signé et isolation à construire, et aucune barrière
au niveau de la base en cas d'oubli dans un service.

## Décisions encore ouvertes

À traiter par des ADR distincts avant le socle technique (B-08) :

| Sujet | Proposition de l'orchestrateur |
|---|---|
| Structure du dépôt | Monorepo npm workspaces : `apps/web`, `packages/*`, `supabase/` |
| Backend | Route handlers et Server Actions de Next.js pour le MVP ; `apps/api` séparée seulement si les workers l'exigent |
| Recherche | Recherche plein texte PostgreSQL pour le MVP ; moteur dédié ensuite |
| Internationalisation | `next-intl`, fr et en |
| Hébergement | Vercel pour le web, Supabase hébergé pour les données |
| File de tâches | À étudier avec les connecteurs (B-15) |
| Tests | Vitest, Playwright, tests RLS sur Supabase local |
