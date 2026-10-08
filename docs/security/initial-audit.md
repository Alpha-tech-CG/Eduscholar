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
- 6 octobre 2026 — Sources de projet et fiches de lecture (C-02) relues par l'agent
  sécurité : aucun constat critique ou élevé, 2 moyens et 6 faibles. Cloisonnement,
  rattachement croisé et absence d'oracle jugés sains. Corrigés : volume non plafonné par
  compte, source reprise d'une fiche ensuite retirée gardant la caution du catalogue et
  un lien cliquable, institution d'un article prise pour son éditeur, caractères
  invisibles moins filtrés sur les champs d'une ligne, erreur de lecture présentée comme
  une liste vide. Non corrigé : la redirection après écriture utilise l'identifiant de
  projet du formulaire (sans effet sur les données). Ces corrections n'ont pas fait
  l'objet d'une seconde revue.
- 6 octobre 2026 — Plan du mémoire (C-04) relu par l'agent sécurité : aucun constat
  critique ou élevé, 1 moyen et 6 faibles. Cloisonnement, rattachement croisé des
  citations, ordre des contrôles et verrous jugés sains. Corrigés : volume de texte non
  borné par compte, faux conflit d'édition après un déplacement, contrôle de
  concurrence qui s'ouvrait en silence sans date de lecture, fins de ligne Windows
  comptées double, projet supprimable pendant une écriture, citations au-delà de cent
  non affichées. Acceptés et consignés : limite quotidienne contournable par ajout puis
  suppression (stock borné), pas de limite de débit sur les enregistrements (D-24). Ces
  corrections n'ont pas fait l'objet d'une seconde revue.
- 7 octobre 2026 — Exports (C-05) relus par l'agent sécurité : aucun constat critique
  ou élevé, 4 moyens et 7 faibles. Écriture du DOCX, neutralisation du Markdown, en-têtes
  et contrôle d'accès jugés sains. Corrigés : copie des données d'un modérateur contenant
  les signalements d'autrui, export déclenchable depuis un autre site, copie complète sans
  mot de passe ni trace, coût non borné (page non limitée, compression bloquante, document
  sans plafond), export tronqué remis comme complet, pagination instable, adresses
  altérées dans le Markdown, noms de fichiers réservés. Reste en dette : D-25. Ces
  corrections n'ont pas fait l'objet d'une seconde revue.
- 7 octobre 2026 — Administration des rôles et des comptes (D-01, D-02, D-16) relue par
  l'agent sécurité : aucun constat critique ou élevé, aucun chemin d'élévation de
  privilège trouvé ; 4 moyens et 9 faibles. Corrigés : rétablissement par un rang
  inférieur d'une suspension décidée par un supérieur, motif et auteur d'une suspension
  modifiables sans trace, limites de recherche et de suspension tenues par la seule
  application, retrait d'un rôle à un pair ou à un supérieur, course entre attribution
  et suspension, garde du dernier super-administrateur contournable. Écrite : la
  procédure du premier super-administrateur. Reste en dette : D-26. Ces corrections
  n'ont pas fait l'objet d'une seconde revue.
- 7 octobre 2026 — Codes de secours et notifications du second facteur (D-17, D-18)
  relus par l'agent sécurité : aucun constat critique ou élevé ; la voie de secours
  tient face à qui n'a que le mot de passe. 6 moyens et 7 faibles. Corrigés : levée sans
  aucun signal au titulaire (avertissement à l'écran et fermeture des autres sessions ;
  le courriel reste en dette D-27), rôle d'administrateur d'organisation récupérable
  après levée puis réenrôlement, dernier super-administrateur neutralisable, génération
  sans mot de passe et rachat en session `aal2`, codes survivant à un changement de
  facteur, codes de dix signes attaquables hors ligne en cas de fuite. Ces corrections
  n'ont pas fait l'objet d'une seconde revue.
- 7 octobre 2026 — Purge planifiée et modèles de courriel inutilisés (D-12, D-13,
  D-23) : purge nocturne en base, exécutable par aucun rôle de l'API ; les parcours du
  service que l'application n'utilise pas envoient un message sans lien ni code. Les
  deux réglages sont à reproduire sur chaque projet hébergé. Relu par l'agent sécurité :
  aucun constat critique ou élevé, 2 moyens et 6 faibles. Corrigés : ligne d'audit
  permanente par compte purgé (un tiers faisait grossir le journal), tâche pouvant
  échouer sans bruit sous un autre rôle, compte suspendu purgé avec sa suspension, lien
  de confirmation invalidé en cours de validité, adresse répétée dans le message
  neutre, tests incomplets. Accepté : les deux purges partagent une transaction (un
  test de configuration interdit la clé étrangère qui la bloquerait). Ces corrections
  n'ont pas fait l'objet d'une seconde revue.
- 7 octobre 2026 — Enregistrement automatique de la rédaction (D-24) : limite de débit
  des enregistrements tenue en base, par compte ; un conflit ne s'écrase que par un
  geste explicite de l'utilisateur. Relu par l'agent sécurité : aucun constat critique
  ou élevé, 1 moyen et 11 faibles. Corrigés : texte perdu en quittant la page par un
  lien ou un autre formulaire avant l'enregistrement, choix perdu en silence dans un
  conflit, lecture échouée présentée comme une suppression, titre et niveau de l'autre
  version non montrés, interblocage possible entre enregistrement et ajout de section,
  compteurs jamais purgés, identifiant du compte en clair dans la clé du compteur,
  refus définitif retenté sans fin, tests qui ne prouvaient pas leur énoncé. Accepté :
  la limite ne compte que les enregistrements aboutis, et une fenêtre fixe laisse passer
  jusqu'à 400 enregistrements à cheval sur deux fenêtres. Ces corrections n'ont pas fait
  l'objet d'une seconde revue.
- 7 octobre 2026 — Révocation immédiate (D-19) : un jeton dont la session a été fermée
  ne lit ni n'écrit plus rien en base, prouvé par appel direct avec un vrai jeton. Un
  test intermittent a mis au jour une fenêtre de rejeu d'un code à six chiffres entre
  deux pas de trente secondes : consignée en dette D-28, non corrigée (arbitrage de
  produit). Relu par l'agent sécurité : aucun constat critique ou élevé, aucun chemin
  restant en base pour une session fermée ; 1 moyen et 5 faibles. Corrigés : tests sans
  témoin positif, terme de session ignoré, `my_report_ids` sans la règle du compte
  actif, `must_keep_second_factor` répondant à une session fermée. Accepté et écrit au
  modèle de menaces : jeton sans identifiant de session non refusé. Constat antérieur
  noté en dette D-29 : la suspension ne ferme pas les sessions du service
  d'authentification. Ces corrections n'ont pas fait l'objet d'une seconde revue.
- 7 octobre 2026 — Rejeu d'un code et suspension (D-28, D-29) : un code accepté
  interdit tout second code du facteur pendant 60 à 90 s ; la suspension ferme les
  sessions du compte et l'empêche d'en rouvrir une. Relu par l'agent sécurité : un
  constat élevé, confirmé par un essai — l'interdiction de connexion du service
  (« bannissement ») répondait « compte banni » même à un mauvais mot de passe, et
  révélait donc l'existence et la sanction d'un compte. Elle a été retirée au profit d'un
  refus en base à l'ouverture de session, ce qui supprime aussi l'état incohérent entre
  la base et le service et l'appel du rôle serveur (trois constats moyens). Acceptés et
  écrits : l'attente entre deux codes suppose des horloges synchronisées entre le
  service et la base ; `second_factor_wait_seconds` apprend à qui détient le mot de
  passe qu'un code vient d'être accepté ; onze codes faux envoyés au service ferment
  les sessions du titulaire (règle antérieure, voulue). Ces corrections n'ont pas fait
  l'objet d'une seconde revue.
- 7 octobre 2026 — Copie des données, égards dus aux sources, avis par courriel,
  conservation du journal (D-25, D-20, D-27, D-03) relus par l'agent sécurité : aucun
  constat critique ou élevé, 3 moyens et 5 faibles, tous corrigés sauf un. Corrigés :
  la copie des données révélait au titulaire qu'un administrateur avait cherché son
  compte (liste fermée d'actions désormais) ; un seul modérateur pouvait épuiser le
  plafond journalier d'une source (part de 300 imports par jour) ; l'envoi de courriel
  pouvait retomber en clair (chiffrement exigé hors boîte locale) ; l'exception de
  purge s'étendait à l'historique de modération ; réglage de conservation non borné ;
  avis de suspension envoyé à une adresse non confirmée. Accepté : un administrateur
  qui alterne suspension et rétablissement peut envoyer jusqu'à soixante avis par heure
  à une même boîte. Ces corrections n'ont pas fait l'objet d'une seconde revue.
- 7 octobre 2026 — Partage d'un projet avec un encadreur (E-01) relu par l'agent
  sécurité : aucun constat critique ou élevé, le cloisonnement et l'invitation sont
  conformes au modèle ; 4 moyens et 7 faibles. Corrigés : un membre retiré revenait par
  une invitation restée en attente ; le courriel d'invitation pouvait servir à harceler
  une adresse (trois par jour au plus, tous expéditeurs confondus) ; l'adresse de la
  personne qui invite, si elle est façonnée, n'est plus reprise dans le courriel ;
  lecture du document sans débit en base ; invitations closes jamais effacées ; journal
  du retrait incomplet ; tests qui annonçaient plus qu'ils ne prouvaient. Acceptés : le
  propriétaire voit l'adresse actuelle du compte d'un membre ; la réponse « courriel non
  parti » peut refléter le refus d'une boîte par le relais. Ces corrections n'ont pas
  fait l'objet d'une seconde revue.
- 8 octobre 2026 — Commentaires sur un projet partagé (E-02) relus par l'agent
  sécurité : aucun constat critique ou élevé, cloisonnement conforme, pas d'injection ni
  de redirection ouverte ; 2 moyens et 6 faibles. Corrigés : un encadreur pouvait
  saturer le projet et priver l'étudiant de la parole (plafonds par auteur) ; un
  identifiant de compte supprimé restait sur ses commentaires (mis à vide désormais) ;
  un membre redevenu lecteur modifiait encore ses commentaires ; un fil clos recevait
  des réponses par appel direct ; l'adresse des membres était rendue entre membres.
  Défaut trouvé en vérifiant le lot : le propriétaire d'un projet partagé ne pouvait
  plus supprimer son compte (corrigé, avec tests de non-régression). À arbitrer : le
  texte des commentaires d'un compte supprimé reste dans le projet d'autrui. Ces
  corrections n'ont pas fait l'objet d'une seconde revue.
- 8 octobre 2026 — Versions soumises et décisions (E-03) relues par l'agent sécurité :
  aucun constat critique ou élevé, cloisonnement et immuabilité conformes ; 4 moyens et
  6 faibles. Corrigés : la liste des versions décompressait tous les instantanés et
  n'avait pas de limite de débit ; les versions échappaient à tout plafond de stockage
  (3 Mo par version, 60 Mo par compte) ; la lecture chargeait le document avant
  d'autoriser et transportait la version précédente entière (empreintes désormais) ;
  la copie des données ignorait versions et décisions ; aucune voie d'effacement d'une
  version soumise par erreur ; immuabilité tenue par la seule absence de droits
  (déclencheur de garde ajouté) ; adresse d'un encadreur retiré encore rendue. Accepté :
  les fenêtres fixes laissent passer le double d'un plafond à cheval sur deux fenêtres ;
  un quota de lecture dépassé s'affiche comme « introuvable ». Ces corrections n'ont pas
  fait l'objet d'une seconde revue.
- 8 octobre 2026 — Tâches et échéances (E-04) relues par l'agent sécurité : aucun
  constat critique ou élevé, cloisonnement conforme ; 2 moyens et 6 faibles. Corrigés :
  la copie des données rendait à un membre retiré le texte actuel de ses anciennes
  tâches ; un encadreur pouvait remplir le projet (trente tâches ouvertes au plus par
  membre) ; quota commun aux créations et aux modifications ; intitulé non contrôlé en
  type ; verrou posé avant le contrôle de rôle. Accepté : le retard d'une échéance se
  calcule en temps universel. Ces corrections n'ont pas fait l'objet d'une seconde revue.
- 8 octobre 2026 — Notifications internes (E-05) relues par l'agent sécurité : aucun
  constat critique ou élevé, aucune fuite ni fabrication possible ; 2 moyens et 4
  faibles. Corrigés : un seul projet pouvait faire taire toutes les notifications d'une
  personne (plus de doublon, plafond par projet, effacement au retrait d'un membre) ;
  une notification impossible à écrire annulait l'événement ; tests complétés.
  Acceptés : « tout marquer comme lu » marque aussi une notification arrivée entre
  l'affichage et le clic ; les notifications ne figurent pas dans la copie des données
  (déclaré dans le fichier). Ces corrections n'ont pas fait l'objet d'une seconde revue.
- 8 octobre 2026 — Portée limitée et lien de partage (E-06) relus par l'agent sécurité :
  aucun constat critique ou élevé ; 3 moyens et 5 faibles. Corrigés : un membre
  élargissait sa portée ou son rôle en acceptant une invitation plus ancienne restée en
  attente (toute décision sur un membre annule désormais ses invitations en attente) ;
  la fiche rendue à un membre limité dépassait le modèle (titre, statut et échéance
  seulement) ; une demande refusée se répétait aussitôt ; désactiver le lien laissait
  les demandes en attente ; la copie des données rendait le passage cité d'une section
  refermée. Acceptés : qui tient un lien peut savoir s'il vaut encore ; le jeton du lien
  figure dans l'adresse de la page ; l'accord du propriétaire donne l'accès complet, au
  rôle que proposait le lien au moment de la demande. Ces corrections n'ont pas fait
  l'objet d'une seconde revue.
- 8 octobre 2026 — Courriel des notifications, désabonnement par lien et rappel
  d'échéance relus par l'agent sécurité : aucun constat critique ou élevé ; 2 moyens et
  9 faibles. Corrigés : les deux fonctions du rôle de service ne laissaient aucune trace
  (une ligne d'audit par envoi, un événement lisible par le titulaire au désabonnement) ;
  un compte banni ou supprimé auprès du service d'authentification restait prévenu ;
  activer le courriel prévenait de notifications anciennes ; un rappel d'échéance qui ne
  pouvait pas s'écrire était perdu ; la page de désabonnement acceptait n'importe quel
  segment et n'interdisait pas le cache ; l'adresse du destinataire pouvait être lue
  comme une liste ; les envois échoués n'étaient pas comptés au journal ; la limite de
  débit du désabonnement, trop basse, pouvait fermer cette voie à tous quand l'adresse
  du client n'est pas connue (portée à 300 par quart d'heure). Acceptés : le jeton de
  désabonnement est durable et figure dans l'adresse de la page — il ne permet que de
  couper ces courriels, ce que le titulaire annule depuis son compte ; les destinataires
  sont marqués avant l'envoi ; `APP_URL` n'est pas contraint à `https` par le code — à
  vérifier au déploiement ; la route planifiée se distingue d'une page absente. Ces
  corrections n'ont pas fait l'objet d'une seconde revue.
- 8 octobre 2026 — Alerte de nouvelle connexion et compteurs de l'authentification
  (D-09, partie) relus par l'agent sécurité : aucun constat critique ou élevé ; 3 moyens
  et 9 faibles. Corrigés : l'enregistrement d'un navigateur était appelable par
  l'utilisateur, ce qui permettait à qui tenait le mot de passe de faire connaître son
  navigateur sans avis, d'évincer ceux du titulaire ou de rendre l'alerte muette (réservé
  au rôle de service) ; un compte sans navigateur connu passait pour neuf (il prévient
  dès qu'il a plus d'une heure) ; les navigateurs connus survivaient au changement de mot
  de passe ; la même empreinte reliait les comptes d'un poste partagé ; deux connexions
  simultanées donnaient deux avis ; l'envoi retardait la connexion ; l'avis partait à
  l'adresse du formulaire plutôt qu'à celle du compte ; les avis n'étaient pas plafonnés
  (trois par jour). Acceptés : une connexion par appel direct au service
  d'authentification ne prévient pas ; les compteurs sont des agrégats, qu'un anonyme
  peut gonfler et où une attaque lente sur un seul compte ne se voit pas ; une panne du
  service d'authentification est comptée comme un échec ; l'usage d'un code de secours
  ne fait pas oublier les navigateurs connus. Ces corrections n'ont pas fait l'objet
  d'une seconde revue.
- 8 octobre 2026 — Suites du journal d'administration (D-26) relues par l'agent
  sécurité : aucun constat critique ou élevé ; 4 moyens et 6 faibles. Corrigés : un
  compte sans rôle pouvait déclarer des refus qu'il n'avait pas pu essuyer ; le plafond
  des refus, par compte seulement, laissait gonfler un journal qui ne se vide pas ; son
  dépassement était silencieux ; le bloc d'exception du plafond avalait toute erreur ;
  la lecture de l'historique d'un compte inexistant écrivait une ligne ; une vague de
  suspensions pouvait chasser de la liste les détenteurs d'un rôle. Reportés (D-31) : le
  refus opposé à un appel direct de l'API n'est pas consigné en base ; conservation de
  l'historique des suspensions. Acceptés : tout administrateur lit l'historique de tout
  compte ; une nouvelle suspension écrite hors des fonctions, au motif identique, n'est
  pas historisée. Ces corrections n'ont pas fait l'objet d'une seconde revue.
- 8 octobre 2026 — Fonction de recherche du catalogue (D-21) relue par l'agent
  sécurité : aucun constat critique ou élevé ; aucune fuite d'une fiche non lisible ;
  2 moyens et 6 faibles, tous de coût ou de robustesse. Corrigés : un mot d'une lettre
  développait presque tout l'index ; un filtre inventé, par appel direct, faisait
  parcourir le catalogue deux fois ; l'index couvrait aussi les fiches non lisibles, d'où
  un canal temporel faible ; la page acceptait des chiffres d'une autre écriture ; la
  règle des mots dépendait de la langue de la base ; la forme des mots n'était vérifiée
  qu'après leur lecture ; le refus pour débit se confondait avec une panne. Non retenu :
  un délai propre à la fonction, sans effet sur la requête appelante. Ces corrections
  n'ont pas fait l'objet d'une seconde revue.
- 8 octobre 2026 — Refus d'administration consignés par la base (D-31) relus par
  l'agent sécurité : aucun constat critique ou élevé, et aucun chemin où un refus
  rendrait un succès ; 3 moyens et 5 faibles. Corrigés : l'application déduisait le
  succès de la seule absence d'erreur du client, juste avant de lire une adresse par le
  rôle serveur et d'envoyer un avis (elle exige désormais un succès sans erreur ni
  contenu) ; le plafond de la plateforme faisait taire en silence les refus d'un
  administrateur ; la liste des comptes et les compteurs de l'authentification n'étaient
  pas couverts ; le décompte du journal précédait le quota et n'avait pas d'index ;
  l'opération consignée était un texte libre ; une rafale de décisions pouvait chasser
  des motifs récents à la purge. Accepté : une limite de débit de la base, opposée à un
  administrateur reconnu, n'est pas consignée. Ces corrections n'ont pas fait l'objet
  d'une seconde revue.

## Suivi

Les corrections sont planifiées dans `docs/backlog.md` (B-01, B-03, B-04, B-05, B-07, B-08).
