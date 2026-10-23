# Mise en production d'EduScholar

**Rédigé le :** 23 octobre 2026
**Décisions du porteur de projet :** base de données en Europe, Paris (`eu-west-3`) ;
ouverture en **pilote restreint** (inscription fermée au public, comptes invités) tant que
les textes de `docs/product/` ne sont pas validés par un juriste.
**Références :** ADR-0006 (hébergement), ADR-0007, ADR-0009, ADR-0011, ADR-0012,
`docs/environment.md`, `docs/security/authorization-model.md`.

Chaque étape dit **qui** la fait. « Vous » : le porteur de projet, parce qu'elle demande
de créer un compte, de choisir une offre payante, ou de saisir un mot de passe ou une clé
secrète. « Claude » : ce que l'agent fait une fois votre étape faite. Aucun secret ne
transite par la conversation : vous les saisissez vous-même dans les tableaux de bord.

Faites d'abord tout le parcours sur un projet de **staging**, puis refaites-le sur la
**production**. La procédure est la même ; seules les valeurs changent.

---

## 1. Dépôt GitHub — fait

- Code poussé sur `https://github.com/Alpha-tech-CG/Eduscholar` (branche `main`).
- **Vous** : le dépôt est **public**. Passez-le en privé si ce n'est pas voulu
  (Settings → General → Danger Zone). Le code ne contient aucun secret, mais il expose
  les rapports de sécurité et les risques acceptés.
- **Vous** (dette D-06) : Settings → Branches → règle de protection sur `main` : exiger
  que l'intégration continue passe, interdire le push forcé. **Claude** ajoutera
  `CODEOWNERS` et épinglera les actions par empreinte.

## 2. Supabase

### 2.1 Créer le projet — vous

1. Sur supabase.com, créez une organisation si besoin, puis un projet :
   région **Europe West (Paris)**, offre au moins **Pro** (sauvegardes quotidiennes,
   pas de mise en pause, et protection native contre les mots de passe divulgués).
2. Choisissez un mot de passe de base de données long, gardé dans votre gestionnaire de
   mots de passe. Ne le communiquez pas dans la conversation.
3. Donnez à Claude **la référence du projet** (les 20 caractères de l'adresse
   `https://<référence>.supabase.co`). Ce n'est pas un secret.

### 2.2 Relier le poste et appliquer le schéma — vous, puis Claude

Dans un terminal, à la racine du dépôt :

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <référence>
```

```bash
npx supabase db push
```

`link` et `db push` demandent le mot de passe de la base : c'est vous qui le tapez.
`db push` applique les 81 migrations ; elles ont été rejouées sur une base vide par
l'intégration continue. **Claude** vérifie ensuite, sans aucun secret : migrations
appliquées, tâches `pg_cron` planifiées, extensions présentes.

### 2.3 Réglages du service d'authentification — vous, avec Claude

À faire dans le tableau de bord (Authentication). `supabase config push` n'est pas
utilisé : `supabase/config.toml` porte des valeurs locales (`localhost`, boîte aux lettres
de test) qui ne doivent pas partir vers un projet hébergé (dette D-05 : à outiller plus
tard par un fichier de configuration propre à chaque environnement).

| Réglage | Valeur |
|---|---|
| Site URL | l'adresse publique de l'application (`APP_URL`) |
| Redirect URLs | `APP_URL/**` seulement |
| Allow new users to sign up | **désactivé** (pilote restreint) — les comptes sont créés par invitation depuis le tableau de bord |
| Confirm email | activé |
| Secure password change | activé ; exiger une connexion récente (dette D-10) |
| Minimum password length | 12, lettres et chiffres |
| Leaked password protection | **activé** (offre Pro) |
| Multi-factor : TOTP | activé |
| Hook « MFA verification attempt » | fonction Postgres `private.hook_mfa_verification_attempt` (refus du rejeu d'un code, verrouillage après dix essais) |
| SMTP personnalisé | le même serveur que `SMTP_URL`, domaine authentifié (SPF, DKIM, DMARC) |
| Modèles de courriel | reproduire les modèles neutralisés de la dette D-13 : lien magique, changement d'adresse, invitation, réauthentification ; voir `docs/architecture/authentication.md` |
| Rate limits | garder les valeurs par défaut du service ou plus strictes |

**Claude** vous fournira, pour les modèles de courriel, le texte exact à coller.

### 2.4 Défi anti-robot — vous, dans cet ordre

1. Sur dash.cloudflare.com → Turnstile : ajoutez un site pour le domaine de
   l'application, mode « Managed ». Vous obtenez une **clé de site** (publique) et un
   **secret**.
2. Donnez la **clé de site** à Claude, qui la pose dans Vercel (`TURNSTILE_SITE_KEY`).
3. Déployez (étape 3), vérifiez que le widget s'affiche sur la page de connexion.
4. **Ensuite seulement** : Supabase → Authentication → Attack Protection → CAPTCHA,
   fournisseur Turnstile, collez le **secret**. L'inverse fermerait la connexion à tous.
5. **Claude** fait la vérification de l'ADR-0011 : un appel direct sans jeton doit être
   refusé (`captcha_failed`), la connexion par l'application doit aboutir.

## 3. Vercel

### 3.1 Créer le projet — vous, ou Claude par la ligne de commande

La ligne de commande Vercel est connectée au compte `mastefox2742`. Le projet peut être
créé par l'import du dépôt GitHub dans le tableau de bord, avec :

- **Root Directory** : `apps/web` ;
- framework : Next.js ; commande de build par défaut ;
- **Production Branch** : `main`.

### 3.2 Variables d'environnement

Les variables **secrètes** se saisissent dans Vercel par **vous** (Settings →
Environment Variables), jamais dans la conversation. **Claude** pose les autres.

| Variable | Qui | Valeur |
|---|---|---|
| `SUPABASE_URL` | Claude | `https://<référence>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Claude ou vous | clé publique du projet (Settings → API) |
| `SUPABASE_SECRET_KEY` | **vous** | clé secrète du projet — **secret** |
| `APP_URL` | Claude | adresse publique, sans barre finale, en `https` |
| `SMTP_URL` | **vous** | `smtps://identifiant:secret@hôte:465` — **secret** |
| `MAIL_FROM` | Claude | adresse d'expédition sur le domaine authentifié |
| `CRON_SECRET` | **vous** | valeur aléatoire de 32 caractères au moins — **secret** |
| `TURNSTILE_SITE_KEY` | Claude | clé de site Turnstile (étape 2.4) |
| `PASSWORD_BREACH_CHECK` | Claude | `1` |
| `CROSSREF_MAILTO` | Claude | adresse de contact de l'équipe |

Ne définissez **ni** `CROSSREF_API_URL`, **ni** `CROSSREF_TEST_STUB`, **ni**
`TRUSTED_CLIENT_IP_HEADER` sur Vercel.

### 3.3 Tâche planifiée du courriel des notifications

Une tâche Vercel Cron quotidienne appelle `/api/cron/notification-digest` ; Vercel envoie
d'elle-même `Authorization: Bearer $CRON_SECRET`. **Claude** ajoute le fichier
`apps/web/vercel.json` correspondant.

### 3.4 Domaine et journaux — vous

- Domaine : ajoutez le domaine dans Vercel, puis l'enregistrement DNS demandé.
- Journaux d'accès : leur conservation doit rester à **30 jours au plus** (ils contiennent
  les mots cherchés, ADR-0010).
- Pare-feu Vercel : activez la protection contre les abus et une limite de débit par
  adresse devant l'application (dette D-15, partie hébergeur).

## 4. Vérifications sur staging — Claude

- [ ] La page d'accueil, la connexion et la recherche répondent en `https`.
- [ ] En-têtes servis : politique de sécurité de contenu à nonce, HSTS, `nosniff`,
      `frame-ancestors 'none'`, `Referrer-Policy` (`curl -I`).
- [ ] Le widget Turnstile s'affiche sans refus de la politique de sécurité de contenu, sur
      les sept formulaires ; un appel direct sans jeton est refusé.
- [ ] L'inscription publique est refusée ; un compte invité se connecte, active le second
      facteur, crée un projet.
- [ ] Les tests de bout en bout pointés sur staging, en lecture seule là où ils écriraient
      des données (à préparer).
- [ ] Analyse dynamique de sécurité (DAST, cahier §16.4) : un passage d'OWASP ZAP en mode
      de base sur staging, rapport joint à `docs/reports/`.
- [ ] Le courriel des notifications part une fois, et son lien de désabonnement fonctionne.

## 5. Avant d'ouvrir la production

- [ ] **Sauvegardes** (D-07) : sauvegardes quotidiennes de l'offre Pro vérifiées, et une
      **restauration réussie** sur un projet jetable, consignée dans `docs/reports/`.
- [ ] **Supervision** : alertes Vercel sur les erreurs 5xx et le temps de réponse ;
      alertes Supabase sur l'usage de la base ; une adresse qui les reçoit.
- [ ] **Retour arrière** : la version précédente se rétablit par « Promote » d'un
      déploiement antérieur dans Vercel. Une migration ne se défait pas d'un clic : chaque
      migration dit en tête comment la défaire ; aucune migration destructive sans
      sauvegarde du jour.
- [ ] **Textes juridiques** : en pilote restreint, les pages de politique de
      confidentialité et de conditions sont publiées marquées « version provisoire » et
      citent Cloudflare (Turnstile) et Have I Been Pwned parmi les services tiers.
- [ ] Le premier `super_admin` est désigné en base par vous, comme décrit dans
      `docs/security/administration.md`, avec un second facteur actif ; un second
      `super_admin` est désigné dans la foulée.

## 6. Ouverture publique (plus tard)

Après la validation juridique : réactiver l'inscription, retirer la mention « version
provisoire », relancer la vérification de l'ADR-0011.
