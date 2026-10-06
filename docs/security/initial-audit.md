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
- 6 octobre 2026 — Schéma de fondation (B-09) relu par l'agent sécurité : aucun constat
  critique ou élevé, 8 moyens et 4 faibles. Corrigés par deux migrations de
  durcissement ; le reste est planifié dans la dette de sécurité du backlog (D-01 à D-08).
  Le test de configuration renforcé a révélé un écart réel, corrigé : `service_role`
  détenait `TRUNCATE` sur toutes les tables.
- 6 octobre 2026 — Authentification (B-10) relue par l'agent sécurité : 2 constats
  élevés, 6 moyens, 4 faibles. Les deux élevés ont été reproduits sur l'instance locale
  puis corrigés : détournement de compte par une inscription antérieure non confirmée, et
  jeton des liens par courriel dérivé d'un code à 6 chiffres. Corrigés aussi : confusion
  de session, changement de mot de passe par une session ordinaire, verrouillage ciblé,
  adresse du client falsifiable. Le reste est en dette D-09 à D-14. Ces corrections n'ont
  pas fait l'objet d'une seconde revue.
- 6 octobre 2026 — Référentiels et profil (B-12, B-11) relus par l'agent sécurité : aucun
  constat critique ou élevé, 5 moyens et 5 faibles. Corrigés : complétion du profil
  vérifiable en base, suppression de compte journalisée et refusée à un compte suspendu,
  détection du dernier administrateur faite en base et testée, référentiels fermés aux
  visiteurs anonymes, bornes réelles des champs. Reste en dette : D-15, D-16.
- 6 octobre 2026 — Second facteur, catalogue et modération (B-13, B-14) relus par
  l'agent sécurité : 1 constat élevé, 7 moyens, 4 faibles. L'élevé a été reproduit sur
  l'instance locale puis corrigé : quarante codes erronés acceptés d'affilée sans
  blocage, et un même code accepté deux fois. Un hook en base borne désormais les essais
  à dix par quart d'heure et par facteur et refuse le rejeu. Corrigés aussi : activation
  du second facteur sans mot de passe, rôle privilégié effectif avec un facteur enrôlé
  après coup, désactivation du facteur par un compte privilégié, réinitialisation du mot
  de passe impossible pour un compte à deux étapes, vérification d'une fiche encore
  modifiable par son auteur, DOI réservable par une simple proposition, caractères de
  format dans les titres, modérateur lisant les données internes et les signalements de
  sa propre proposition. Reste en dette : D-18, D-19. Ces corrections n'ont pas fait
  l'objet d'une seconde revue.
- 6 octobre 2026 — Import par DOI (B-15) relu par l'agent sécurité : aucun constat
  critique ou élevé, 1 moyen et 10 faibles. Corrigés : un modérateur pouvait importer,
  vérifier et publier seul une fiche (un autre modérateur est désormais requis), limite
  journalière contournable par des appels simultanés, source sollicitée pour un DOI déjà
  importé, fiche refusée bloquant tout réimport, licence sous embargo ou de version non
  précisée reprise à tort, lien officiel non encodé, adresse de test de la source
  acceptée sans drapeau explicite. Reste en dette : D-20. Ces corrections n'ont pas fait
  l'objet d'une seconde revue.
- 6 octobre 2026 — Recherche, fiche publiée et signalement (B-16) relus par l'agent
  sécurité : aucun constat critique ou élevé, 2 moyens et 4 faibles. Mesuré puis
  accepté avec un seuil de révision : l'index plein texte n'est pas utilisé sous RLS
  (D-21). Corrigés : limite de débit par adresse qui laissait un compte bloquer toute
  son adresse, migration qui suspendait toutes les gardes de la table, recherche en
  échec présentée comme « aucun résultat ». Les tests ont aussi révélé un défaut de la
  file de modération, corrigé : au-delà de cent fiches, les plus récentes n'étaient
  plus affichées. Ces corrections n'ont pas fait l'objet d'une seconde revue.
- 6 octobre 2026 — Favoris et collections (B-17) relus par l'agent sécurité : aucun
  constat critique ou élevé, 2 moyens et 6 faibles. Cloisonnement et absence d'oracle
  d'existence jugés sains. Corrigés : modèle d'autorisation non mis à jour, description
  acceptant des caractères invisibles, course au renommage, noms identiques sous deux
  formes Unicode, listes au-delà de cent éléments inaccessibles, échec de lecture
  présenté comme « plus disponible ». Le contrôle de configuration ferme désormais aussi
  ce que le rôle serveur lit et exécute. Reste en dette : D-22. Ces corrections n'ont
  pas fait l'objet d'une seconde revue.
- 6 octobre 2026 — Projets de recherche privés (C-01) relus par l'agent sécurité : aucun
  constat critique ou élevé, 3 moyens et 7 faibles. Cloisonnement jugé sain pour tous les
  rôles. Corrigés : aucune purge des projets supprimés (fonction écrite, planification
  en dette D-23), plafond contournable par créations et suppressions en boucle,
  enregistrement partiel qui effaçait les champs absents et écrasement entre deux
  onglets, échéance acceptant des valeurs spéciales, caractères invisibles non couverts.
  Non retenu : restreindre la lecture par colonne, la politique devant lire le
  propriétaire et la date de suppression. Ces corrections n'ont pas fait l'objet d'une
  seconde revue.

## Suivi

Les corrections sont planifiées dans `docs/backlog.md` (B-01, B-03, B-04, B-05, B-07, B-08).
