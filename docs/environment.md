# Environnements et variables

**Mise à jour :** 6 octobre 2026 (B-10)
**Références :** ADR-0006, ADR-0007 ; modèle de menaces M-13, M-41, M-45

## Règles

1. Aucun secret dans le dépôt. Les fichiers `.env*` sont ignorés par Git, sauf `.env.example`.
2. Le préfixe `NEXT_PUBLIC_` envoie la variable au navigateur. Aucune variable ne le porte :
   le contrôle `npm run check:secrets` refuse toute variable publique hors d'une liste
   blanche, vide aujourd'hui.
3. Conformément à ADR-0007, le navigateur n'appelle pas Supabase : même l'adresse et la
   clé publique de Supabase sont des variables **serveur**.
4. Les variables serveur ne sont lues que par `apps/web/src/lib/env.server.ts`, qui les
   valide. Seule exception : `TRUSTED_CLIENT_IP_HEADER` et `VERCEL`, lues par
   `src/lib/auth/client-address.ts`, qui n'ont rien de secret.
5. Aucun identifiant de production sur un poste de développement.
6. Une variable ajoutée est documentée ici dans le même changement.

## Variables

| Variable | Secret | Rôle |
|---|---|---|
| `SUPABASE_URL` | non | Adresse du projet Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | non, mais serveur seulement | Clé publique, utilisée avec la session de l'utilisateur |
| `SUPABASE_SECRET_KEY` | **oui** | Clé `service_role` ; usages listés dans `authorization-model.md` §7.5 |
| `APP_URL` | non | Adresse publique de l'application |
| `CROSSREF_MAILTO` | non | Facultative. Adresse de contact transmise à Crossref avec chaque requête (accès « poli », débit plus favorable). Une adresse de l'équipe, jamais celle d'un utilisateur. |
| `SMTP_URL` | oui | Facultative. Serveur d'envoi des avis de sécurité de l'application (ADR-0009), sous la forme `smtps://identifiant:secret@hôte:port`. Sans elle, aucun avis ne part. Le même compte que celui du service d'authentification. |
| `MAIL_FROM` | non | Facultative, requise avec `SMTP_URL`. Adresse d'expédition des avis, sur un domaine authentifié (SPF, DKIM). |
| `CRON_SECRET` | **oui** | Facultative. Valeur aléatoire d'au moins 32 caractères que la tâche planifiée de l'hébergeur présente (`Authorization: Bearer …`) pour déclencher l'envoi du courriel des notifications (`/api/cron/notification-digest`). Sans elle, la route répond « introuvable » et aucun courriel de notification ne part. |
| `CROSSREF_API_URL` | non | À ne pas définir. Vaut `https://api.crossref.org` ; seule autre valeur admise : un serveur de test sur `http://127.0.0.1`, et seulement si `CROSSREF_TEST_STUB=1` hors Vercel (tests de bout en bout). |
| `TRUSTED_CLIENT_IP_HEADER` | non | Hors Vercel : nom de l'en-tête, écrasé par le proxy frontal, qui porte l'adresse du client. Absent : la limitation de débit par client devient commune à tous les visiteurs. |

Aucune variable n'est propre aux exports. Leur taille est bornée par l'hébergeur : la
durée maximale d'une fonction et la taille d'une réponse non diffusée en flux limitent le
document d'un projet et la copie des données d'un gros compte (dette D-25).

Sur Vercel, `VERCEL` est défini par la plateforme et l'adresse du client est lue dans
`x-vercel-forwarded-for`.

## En local

Aucun fichier `.env` n'est nécessaire. `scripts/with-local-env.mjs` lit les valeurs de
l'instance Supabase locale auprès de la CLI et les passe au processus lancé, sans les
écrire ni les afficher. Les commandes `npm run dev`, `npm run test:integration` et
`npm run test:e2e` l'utilisent.

```bash
npm run db:start
npm run dev
```

## Par environnement

| Environnement | Où vivent les valeurs |
|---|---|
| local | Instance Supabase locale, valeurs injectées par `scripts/with-local-env.mjs` |
| test (CI) | Instance Supabase locale démarrée par la CI ; aucun secret réel |
| staging | Variables d'environnement Vercel « Preview », reliées au projet Supabase de staging |
| production | Variables d'environnement Vercel « Production » ; saisies par le porteur de projet, jamais par un agent |

Dans la configuration du projet Supabase hébergé, l'adresse du site (`site_url`) doit
valoir `APP_URL` : les liens des courriels en dépendent.

## Note sur les agents

`.claude/settings.json` interdit aux agents de lire et d'écrire tout fichier `.env*`.
Le fonctionnement local n'en a pas besoin. Un gabarit `.env.example` pourra être créé à
la main à partir du tableau ci-dessus pour documenter un déploiement hors Vercel.
