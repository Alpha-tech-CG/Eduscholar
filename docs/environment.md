# Environnements et variables

**Date :** 6 octobre 2026
**Références :** ADR-0006, ADR-0007 ; modèle de menaces M-13, M-41, M-45

## État

Le socle technique n'utilise **aucune variable d'environnement**. Ce document fixe les
règles et la liste prévue, à compléter à chaque ajout.

## Règles

1. Aucun secret dans le dépôt. Les fichiers `.env*` sont ignorés par Git, sauf `.env.example`.
2. `.env.example` ne contient que des noms et des valeurs fictives.
3. Le préfixe `NEXT_PUBLIC_` envoie la variable au navigateur. Il est interdit pour tout
   secret ; le contrôle `npm run check:secrets` le refuse.
4. Conformément à ADR-0007, le navigateur n'appelle pas Supabase : même l'adresse et la
   clé publique de Supabase sont des variables **serveur**, sans préfixe.
5. Les variables serveur ne sont lues que dans des modules marqués `server-only`, par un
   module unique qui les valide au démarrage.
6. Aucun identifiant de production sur un poste de développement.
7. Une variable ajoutée est documentée ici dans le même changement.

## Variables prévues

| Variable | Portée | Introduite par | Rôle |
|---|---|---|---|
| `SUPABASE_URL` | serveur | B-09 | Adresse du projet Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | serveur | B-09 | Clé publique, utilisée avec la session de l'utilisateur |
| `SUPABASE_SECRET_KEY` | serveur, secret | B-09 | Clé `service_role` ; opérations privilégiées listées dans `authorization-model.md` §7.5 |
| `APP_URL` | serveur | B-10 | Adresse publique de l'application, pour les liens des courriels et la liste blanche de redirection |

Les noms seront confirmés à l'introduction de chaque variable.

## Par environnement

| Environnement | Où vivent les valeurs |
|---|---|
| local | `apps/web/.env.local`, non versionné ; valeurs de l'instance Supabase locale |
| test (CI) | Instance Supabase locale démarrée par la CI ; aucun secret réel |
| staging | Variables d'environnement Vercel « Preview », reliées au projet Supabase de staging |
| production | Variables d'environnement Vercel « Production » ; saisies par le porteur de projet, jamais par un agent |

## Note sur les agents

`.claude/settings.json` interdit aux agents de lire et d'écrire tout fichier `.env*`, y
compris `.env.example`. Le gabarit `.env.example` sera donc créé à la main à partir du
tableau ci-dessus lorsque la première variable apparaîtra (B-09), ou la règle sera
assouplie pour ce seul fichier sur décision du porteur de projet.
