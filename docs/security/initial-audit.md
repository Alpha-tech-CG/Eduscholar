# Audit de sécurité initial

**Date :** 5 octobre 2026
**Périmètre :** dépôt `D:\Eduweb\eduscholar` (10 fichiers), configuration des agents
**Méthode :** lecture des fichiers, recherche de secrets par motifs, revue de
`.claude/settings.json`

## Conclusion

Aucune vulnérabilité applicative : il n'y a pas de code. Aucun secret dans le dépôt.
Les risques sont de processus et de configuration. Deux sont classés HIGH et doivent
être levés avant le premier code.

## Constats

### HIGH

**S-01 — Pas de dépôt Git ni de `.gitignore`**

- Impact : aucun historique, aucune revue, aucune restauration possible. Au premier
  `git init` suivi de `git add .`, un fichier `.env` créé entre-temps serait commité.
- Correction : initialiser Git avec un `.gitignore` couvrant `.env*`, `node_modules`,
  les sorties de build et les fichiers locaux, avant toute création de `.env`.
- Contrôle à ajouter : scan de secrets en pre-commit et en CI.

**S-02 — Modèle d'autorisation et modèle de menaces non écrits**

- Impact : le cahier exige RLS, isolation multi-tenant et 8 rôles. Sans matrice écrite,
  les politiques seront conçues table par table, avec un risque d'IDOR et de fuite
  inter-tenant.
- Correction : rédiger la matrice rôles × ressources × opérations et le modèle de menaces
  avant la première migration.
- Contrôle à ajouter : tests d'isolation utilisateur et organisation dès la première table.

### MEDIUM

**S-03 — Protection de `.env` incomplète dans `.claude/settings.json`**

- Les règles `deny` portent sur `Read(.env)`, `Read(.env.*)`, `Edit` et `Write` : elles
  ne couvrent que la racine et que ces trois outils.
- Scénario : un agent lit `apps/api/.env`, ou exécute `cat .env` via Bash.
- Correction : ajouter `Read(**/.env)`, `Read(**/.env.*)`, les équivalents Edit et Write,
  et des règles Bash sur les commandes de lecture de ces fichiers. Prévoir une exception
  pour `.env.example`.

**S-04 — Commandes destructrices non couvertes**

- `deny` couvre `rm -rf`, `git reset --hard`, `git push --force` et `supabase db reset`.
- Non couvertes : `git clean`, `git push -f`, `npx prisma migrate reset`,
  `npx prisma db push`, `rm -r`, déploiement en production (`vercel --prod`).
- `supabase db push` et `npx prisma migrate` sont en `ask` sans distinction
  d'environnement : rien n'empêche de viser la production après confirmation.
- Correction : compléter `deny`, et ne jamais exposer d'identifiants de production au
  poste de développement.

**S-05 — Couche de données non décidée**

- `settings.json` cite Prisma et Supabase. Avec Supabase, la RLS est la barrière
  principale. Avec Prisma, la connexion contourne la RLS et l'autorisation repose sur le
  code. Mélanger les deux sans règle crée des contournements.
- Correction : décision d'architecture écrite, avec la règle d'usage du rôle de service.

**S-06 — Cadre juridique absent**

- Aucune politique de confidentialité, de contenu, de licences, de retrait, de
  consentement IA ou de protection des mineurs, alors que le produit hébergera des
  mémoires privés et du contenu tiers.
- Correction : brouillons dans `docs/product/`, validation juridique avant toute
  ingestion ou ouverture publique.

**S-07 — Aucune chaîne de contrôle**

- Pas de CI, d'analyse des dépendances, de SAST ni de scan de secrets (cahier §16.4).
- Correction : les mettre en place avec le socle technique, avant la première
  fonctionnalité.

### LOW

**S-08 — `security-reviewer` dispose de Bash**

- L'agent est censé ne pas modifier le code ; Bash le lui permet.
- Correction : retirer Bash, ou le limiter à des commandes de lecture et d'audit.

**S-09 — Cahier des charges hors de `docs/` — LEVÉ**

- `CLAUDE.md` et `orchestrator.md` le cherchent dans `docs/`.
- Levé le 5 octobre 2026 : le cahier est dans `docs/`.

**S-10 — Aucun `.env.example` ni liste de variables**

- Sans gabarit, les variables seront ajoutées au cas par cas, avec un risque de préfixe
  public sur une clé serveur.
- Correction : créer `.env.example` sans valeur, avec la séparation client / serveur.

## Vérifications effectuées

| Vérification | Résultat |
|---|---|
| Secrets en clair (clés, tokens, mots de passe, clés privées, JWT) | Aucun |
| Fichiers `.env*` présents | Aucun |
| `.gitignore` | Absent |
| Dépôt Git | Absent |
| Dépendances vulnérables | Sans objet, aucune dépendance |
| Politiques RLS | Sans objet, aucune base |
| En-têtes, CORS, limitation de débit | Sans objet, aucun service |

## Points conformes

- `Edit` et `Write` sont soumis à confirmation.
- Les fichiers `.env` de la racine sont interdits en lecture et en écriture.
- Les règles d'`AGENTS.md`, de `CLAUDE.md` et des agents sont alignées sur le cahier :
  autorisation côté serveur, pas de RLS permissive, pas de source inventée, pas de
  document privé envoyé à une IA sans consentement.
- Une vulnérabilité CRITICAL ou HIGH bloque la validation.

## Mises à jour

- 6 octobre 2026 — S-01 levé en partie : Git initialisé avec un `.gitignore` couvrant
  `.env*`, les clés et les sorties de build. Le scan de secrets en pre-commit et en CI
  reste à faire (B-08).
- 6 octobre 2026 — S-05 levé : Supabase avec RLS retenu, règles d'usage de `service_role`
  écrites dans `docs/architecture/adr-0001-nextjs-supabase.md`.
- 6 octobre 2026 — S-03 levé en partie : interdiction de `.env` et `.env.*` étendue aux
  sous-dossiers et aux commandes Bash de lecture courantes. Limite : les motifs Bash
  ne couvrent pas toutes les façons de lire un fichier ; la vraie protection reste de ne
  placer aucun secret de production sur le poste. Conséquence : les agents ne peuvent
  ni lire ni écrire `.env.example`.
- 6 octobre 2026 — S-04 levé : `git clean`, `git push -f`, `rm -r`, Prisma, déploiement
  et suppression Vercel en production, `supabase db push --linked` interdits ; commandes
  Supabase et Vercel restantes soumises à confirmation.
- 6 octobre 2026 — S-08 levé : `security-reviewer` n'a plus que Read, Grep et Glob.
- 6 octobre 2026 — S-02 levé sur le plan documentaire : `authorization-model.md` et
  `threat-model.md` rédigés puis revus par l'agent sécurité (5 HIGH, 8 MEDIUM, 2 LOW,
  tous intégrés). Les corrections n'ont pas fait l'objet d'une seconde revue. Le modèle
  d'autorisation reste à valider par le porteur de projet avant la première migration.
- 6 octobre 2026 — S-01 levé : contrôle de secrets en pre-commit (activé par
  `npm install`) et en CI, complété par Gitleaks en CI.
- 6 octobre 2026 — S-07 levé en partie : la chaîne lint, typecheck, tests, build, audit
  des dépendances et contrôle du bundle existe et passe en local. La CI est écrite mais
  n'a jamais tourné, faute de dépôt distant.
- 6 octobre 2026 — S-10 ouvert : aucune variable n'existe encore ; la liste prévue est
  dans `docs/environment.md`. Les agents ne peuvent pas écrire `.env.example`.
- 6 octobre 2026 — Socle technique relu par l'agent sécurité : aucun constat critique ou
  élevé, 6 moyens et 6 faibles, traités ou reportés avec échéance dans ADR-0008.

## Suivi

Les corrections sont planifiées dans `docs/backlog.md` (B-01, B-03, B-04, B-05, B-07, B-08).
