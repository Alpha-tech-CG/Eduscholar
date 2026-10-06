# EduScholar

Plateforme de recherche académique, de bibliothèque personnelle et d'accompagnement à la
rédaction. Le dépôt contient le socle technique, la base de fondation et
l'authentification ; aucune fonctionnalité métier pour l'instant.

## Documentation

| Sujet | Document |
|---|---|
| Cahier des charges | `docs/EDUSCHOLAR_CAHIER_DES_CHARGES_COMPLET.md` |
| Avancement et priorités | `docs/backlog.md` |
| Décisions d'architecture | `docs/architecture/adr-*.md` |
| Modèle d'autorisation | `docs/security/authorization-model.md` |
| Modèle de menaces | `docs/security/threat-model.md` |
| Politiques (brouillons) | `docs/product/` |
| Variables d'environnement | `docs/environment.md` |
| Base de données | `docs/architecture/database.md` |
| Authentification | `docs/architecture/authentication.md` |
| Règles pour les agents | `AGENTS.md`, `CLAUDE.md` |

## Structure

```text
apps/web      application Next.js (App Router)
packages/     code partagé (vide pour l'instant)
scripts/      contrôles : secrets, bundle client
docs/         documentation
```

## Démarrage

Prérequis : Node.js 22 ou plus.

```bash
npm install
npm run db:start
npm run dev
```

L'application répond sur http://localhost:3000 et redirige vers `/fr` ou `/en`.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run lint` | ESLint, zéro avertissement toléré |
| `npm run typecheck` | Types des routes puis TypeScript strict |
| `npm test` | Tests unitaires (Vitest) |
| `npm run build` | Build de production |
| `npm run db:start` | Démarre l'instance Supabase locale (Docker requis) |
| `npm run test:db` | Tests de la base (pgTAP) |
| `npm run test:integration` | Tests par appel direct à l'API de l'instance locale |
| `npm run test:e2e` | Tests de bout en bout (Playwright), après un build, instance locale démarrée |
| `npm run check:secrets` | Recherche de secrets dans les fichiers suivis |
| `npm run check` | Secrets, lint, types et tests unitaires |

Première exécution des tests de bout en bout :

```bash
npx playwright install chromium
```

## Règles à connaître

- Aucun texte en dur dans un composant : tout passe par `apps/web/messages/fr.json` et
  `en.json`, qui doivent avoir les mêmes clés.
- Le navigateur n'appelle jamais Supabase directement (ADR-0007).
- Toute autorisation est vérifiée côté serveur et imposée en base.
- Aucun secret dans le dépôt ; le pre-commit et la CI le contrôlent.
