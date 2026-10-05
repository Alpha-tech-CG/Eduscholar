# EduScholar — Cahier des charges complet

**Version :** 1.0  
**Date :** 5 octobre 2026  
**Statut :** document de référence produit, fonctionnel, technique et sécurité  
**Cible initiale :** Afrique francophone et anglophone, avec extension mondiale dès la sortie  
**Nom de travail :** EduScholar / StudyHub / ScholarCampus

---

## 1. Vision du projet

EduScholar est une plateforme mondiale de recherche et d’accompagnement académique destinée aux lycéens, étudiants, enseignants, encadreurs, chercheurs, bibliothèques et établissements.

Elle combine :

1. Un moteur de recherche spécialisé par domaine d’études.
2. Un catalogue de cours, articles, livres ouverts, thèses, mémoires, vidéos, exercices et ressources institutionnelles.
3. Une bibliothèque personnelle pour organiser les ressources.
4. Un atelier de recherche pour construire un sujet, une problématique, un plan et une revue de littérature.
5. Un éditeur de mémoire ou de thèse avec citations, bibliographie et historique des versions.
6. Un espace de collaboration entre étudiant et encadreur.
7. Un système de vérification de qualité, de provenance, de licences et de cohérence.

> La plateforme aide l’étudiant à trouver, comprendre, organiser et produire. Elle ne remplace ni l’étudiant, ni l’enseignant, ni l’encadreur.

---

## 2. Problèmes à résoudre

- Les ressources éducatives sont dispersées et difficiles à filtrer.
- Les étudiants ne savent pas toujours distinguer une source fiable d’un document douteux.
- Les contenus sont rarement organisés selon la filière, le niveau et le pays.
- La recherche documentaire et la revue de littérature sont difficiles pour les débutants.
- Les références bibliographiques sont souvent incomplètes ou incohérentes.
- Les outils existants sont parfois chers, complexes ou mal adaptés aux connexions africaines.
- Les universités africaines disposent de ressources peu visibles à l’international.
- Les interactions entre étudiants, encadreurs et bibliothèques sont fragmentées.
- Les solutions internationales ne prennent pas toujours en compte le français, l’anglais, les langues locales et les contextes pédagogiques régionaux.

---

## 3. Objectifs

### 3.1 Objectifs produit

- Permettre une recherche rapide par filière, matière, niveau, pays, langue et type de ressource.
- Prioriser les ressources gratuites, ouvertes ou légalement accessibles.
- Valoriser les contenus des universités et chercheurs africains.
- Aider l’étudiant à organiser une bibliothèque personnelle.
- Guider la création d’un projet de mémoire ou de thèse.
- Automatiser les tâches répétitives sans inventer de sources.
- Faciliter le suivi avec l’encadreur.
- Fonctionner sur mobile, PWA et réseaux faibles.
- Préparer une architecture multilingue et multi-pays dès le départ.

### 3.2 Objectifs non fonctionnels

- Sécurité par défaut.
- Confidentialité des mémoires non publiés.
- Scalabilité mondiale.
- Traçabilité des modifications.
- Disponibilité et résilience.
- Accessibilité numérique.
- Respect des droits d’auteur et des licences.
- Observabilité et capacité d’audit.

---

## 4. Publics et rôles

### 4.1 Visiteur

- Rechercher des ressources publiques.
- Consulter les fiches et les pages de filière.
- Créer un compte.

### 4.2 Étudiant

- Gérer son profil académique.
- Rechercher et sauvegarder des ressources.
- Créer des collections et des notes.
- Créer un projet de recherche.
- Rédiger et exporter son document.
- Partager un projet avec un encadreur.

### 4.3 Enseignant / encadreur

- Gérer les projets partagés.
- Commenter des passages.
- Créer des tâches et échéances.
- Valider ou demander des corrections.
- Publier des ressources autorisées.

### 4.4 Bibliothécaire / institution

- Administrer un catalogue institutionnel.
- Importer des ressources.
- Définir les droits d’accès.
- Vérifier les métadonnées.
- Consulter les statistiques.

### 4.5 Contributeur

- Proposer un lien, un fichier, un cours, une fiche ou un mémoire autorisé.
- Suivre l’état de validation.

### 4.6 Modérateur

- Vérifier les sources, licences, doublons et signalements.
- Retirer une ressource problématique.
- Traiter les demandes de retrait.

### 4.7 Administrateur de plateforme

- Gérer les utilisateurs, rôles, paramètres, taxonomies et intégrations.
- Superviser la sécurité et les audits.
- Administrer les organisations et les plans.

### 4.8 Super-administrateur

- Gestion technique limitée et fortement auditée.
- Aucun accès automatique au contenu privé des utilisateurs.
- Accès exceptionnel sous procédure d’incident et journalisation renforcée.

---

## 5. Principes produit

1. **Source avant résumé :** toute information académique importante doit être rattachée à une source.
2. **Gratuit ne signifie pas libre de copie :** le statut d’accès et la licence doivent être séparés.
3. **L’étudiant reste auteur :** les outils d’assistance ne doivent pas produire un mémoire présenté comme un travail original sans contrôle humain.
4. **Mobile d’abord :** l’application doit rester utilisable sur écran petit, réseau lent et appareil peu puissant.
5. **Ouvert mais sécurisé :** les ressources publiques sont découvrables, les projets privés restent privés.
6. **International dès la conception :** pays, langues, fuseaux horaires, devises, normes et établissements ne doivent pas être codés en dur.
7. **Modulaire :** recherche, bibliothèque, rédaction, collaboration et administration doivent pouvoir évoluer séparément.

---

## 6. Périmètre fonctionnel

### 6.1 Accueil et découverte

- Barre de recherche globale.
- Sélecteur de langue.
- Sélecteur de pays, niveau et filière.
- Ressources populaires et récentes.
- Collections thématiques.
- Pages publiques optimisées pour le référencement.
- Mise en avant des ressources institutionnelles vérifiées.

### 6.2 Profil académique

- Pays et région.
- Établissement.
- Niveau d’études.
- Filière et spécialité.
- Matières suivies.
- Langue préférée.
- Objectifs : cours, révision, mémoire, recherche, projet.
- Paramètres de confidentialité.

Ne jamais rendre public par défaut le nom de l’établissement, la filière ou les projets.

### 6.3 Recherche

Recherche par :

- Mots-clés.
- Titre.
- Auteur.
- DOI.
- Sujet.
- Filière.
- Matière.
- Niveau.
- Pays.
- Institution.
- Langue.
- Type de ressource.
- Année.
- Licence.
- Accès ouvert.
- Disponibilité du texte intégral.

Résultat minimal :

- Titre.
- Auteurs.
- Résumé.
- Source.
- Année.
- Type.
- Langue.
- Licence et statut d’accès.
- Lien officiel.
- Date de dernière vérification.
- Tags.
- Score de qualité explicable.

### 6.4 Catalogue des ressources

Types :

- Cours.
- Article.
- Livre.
- Chapitre.
- Thèse.
- Mémoire.
- Rapport.
- Prépublication.
- Vidéo.
- Exercice.
- Annale.
- Documentation technique.
- Jeu de données.
- Présentation.

Statuts d’accès :

```text
open_access
free_link
preview_only
institutional_access
paid
unknown
removed
```

Statuts éditoriaux :

```text
pending
under_review
verified
published
rejected
suspended
```

### 6.5 Bibliothèque personnelle

- Favoris.
- Collections.
- Notes privées.
- Tags personnels.
- Annotations.
- Historique.
- Import de références.
- Export BibTeX, RIS, CSV et bibliographie.
- Synchronisation multi-appareils.
- Téléchargement uniquement si autorisé.

### 6.6 Soumission de ressources

Formulaire :

- Titre.
- Auteur(s).
- Institution.
- Résumé.
- Type.
- Filière.
- Niveau.
- Pays.
- URL source.
- Fichier éventuel.
- Licence.
- Autorisation de publication.
- Commentaire du contributeur.

Pipeline :

```text
soumis → contrôle automatique → modération → vérifié → publié
                         ↘ rejet / demande de correction
```

### 6.7 Projet de recherche

Champs :

- Titre provisoire.
- Domaine.
- Contexte.
- Problématique.
- Question principale.
- Questions secondaires.
- Hypothèses.
- Objectif général.
- Objectifs spécifiques.
- Cadre théorique.
- Méthodologie.
- Terrain.
- Population et échantillon.
- Plan.
- Échéances.
- Encadreur.
- Statut.

### 6.8 Revue de littérature

Fiche par source :

- Référence complète.
- Problème étudié.
- Concepts.
- Méthode.
- Population et terrain.
- Résultats.
- Limites.
- Citation utile.
- Pages ou sections.
- Lien avec le projet.
- Chapitre cible.

Matrice :

| Source | Thème | Méthode | Résultat | Limite | Utilité |
|---|---|---|---|---|---|
| A | Sujet étudié | Enquête | Résultat principal | Limite | Chapitre |

### 6.9 Éditeur académique

- Édition par chapitres et sections.
- Titres hiérarchisés.
- Notes et commentaires.
- Citations liées à des sources.
- Numéros de pages pour les citations.
- Table des matières.
- Figures et tableaux.
- Légendes.
- Annexes.
- Autosave.
- Mode hors ligne contrôlé.
- Historique des versions.
- Export DOCX, PDF, Markdown et ODT si disponible.

### 6.10 Citations et bibliographie

- Styles configurables : APA, MLA, Chicago, Harvard, Vancouver et styles institutionnels.
- Détection des références incomplètes.
- Détection des doublons.
- Synchronisation citations / bibliographie.
- Import DOI, BibTeX, RIS et métadonnées.
- Possibilité de corriger manuellement chaque champ.
- Aucune citation générée ne doit être considérée comme fiable sans validation.

### 6.11 Collaboration avec l’encadreur

- Invitation par lien ou adresse vérifiée.
- Permissions par projet et par document.
- Commentaires ancrés sur un passage.
- Réponses et résolution des commentaires.
- Tâches et échéances.
- Soumission d’une version.
- Acceptation, refus ou demande de correction.
- Comparaison de versions.
- Historique complet.

### 6.12 Notifications

- Nouvelle ressource dans une collection.
- Commentaire de l’encadreur.
- Échéance proche.
- Version acceptée ou rejetée.
- Lien devenu indisponible.
- Demande de vérification.

Canaux : notification interne, email, push et éventuellement WhatsApp/SMS selon la législation et le consentement.

### 6.13 Administration

- Gestion utilisateurs et organisations.
- RBAC et permissions.
- Gestion pays, langues, niveaux, filières et matières.
- Modération des ressources.
- Gestion des licences.
- Traitement des signalements.
- Gestion des demandes de retrait.
- Santé des connecteurs.
- Journal d’audit.
- Statistiques anonymisées.
- Paramétrage des limites et quotas.

---

## 7. Acquisition et gestion du contenu

### 7.1 Sources autorisées

- APIs académiques et bibliographiques.
- Dépôts universitaires.
- Revues ouvertes.
- Sites officiels.
- Bibliothèques numériques.
- Ressources produites par la plateforme.
- Contributions d’enseignants, étudiants et institutions.
- Partenariats avec universités et bibliothèques.

### 7.2 Connecteurs

```text
connectors/
├── openalex.connector.ts
├── core.connector.ts
├── crossref.connector.ts
├── doaj.connector.ts
├── institutional-repository.connector.ts
└── user-submission.connector.ts
```

Chaque connecteur doit :

1. Authentifier l’accès si nécessaire.
2. Respecter les quotas et conditions de la source.
3. Récupérer seulement les champs autorisés.
4. Normaliser les métadonnées.
5. Conserver la provenance.
6. Détecter les doublons.
7. Vérifier la date et le lien.
8. Envoyer les éléments incertains en modération.

### 7.3 Règles de droit d’auteur

- Ne jamais scraper un site en violation de ses conditions.
- Ne jamais contourner une authentification, un paywall ou une mesure technique.
- Ne pas héberger un fichier sans licence ou autorisation.
- Stocker la licence et la preuve d’autorisation.
- Rediriger vers la source officielle si l’hébergement n’est pas permis.
- Traiter rapidement les demandes de retrait.
- Conserver un historique de la décision de publication.
- Ne pas présenter un document gratuit comme librement redistribuable.

### 7.4 Qualité éditoriale

Score indicatif :

```text
qualité = provenance + complétude + licence + fraîcheur
        + fiabilité institutionnelle + pertinence
        - doublon - lien cassé - signalements non résolus
```

Le score doit être explicable et ne doit pas se présenter comme une validation scientifique absolue.

---

## 8. Fonctionnalités d’assistance algorithmique et IA

### Autorisé

- Classification par filière et matière.
- Extraction de mots-clés.
- Résumé d’un document fourni ou accessible légalement.
- Création d’une fiche de lecture à vérifier.
- Détection de doublons.
- Vérification de structure.
- Détection de références manquantes.
- Suggestions de questions et de thèmes.
- Comparaison de sources avec citations visibles.
- Traduction ou reformulation avec avertissement.

### Interdit ou fortement limité

- Inventer une source, un DOI, un auteur ou une citation.
- Présenter une conclusion générée comme un résultat de recherche.
- Générer automatiquement une thèse prête à déposer.
- Cacher l’utilisation d’une assistance automatisée lorsque l’établissement l’interdit.
- Résumer une source sans conserver la référence utilisée.
- Extraire un document protégé sans autorisation.

### Règles RAG

Toute réponse académique générée doit conserver :

- Les identifiants des sources.
- Les passages utilisés quand c’est possible.
- Les pages ou sections.
- Le niveau de confiance.
- Un avertissement lorsque les sources sont insuffisantes.

En cas d’absence de source, le système doit répondre : « Je ne dispose pas d’une source vérifiable pour confirmer ce point. »

---

## 9. Architecture technique cible

### 9.1 Frontend

```text
apps/web
├── Next.js ou framework équivalent
├── TypeScript
├── Design system partagé
├── PWA
├── i18n
├── gestion d’état limitée et maîtrisée
├── validation côté client non considérée comme sécurité
└── analytics respectueux de la vie privée

apps/mobile
├── React Native / Expo ou équivalent
├── stockage local chiffré des données sensibles
├── synchronisation différée
└── gestion des conflits
```

### 9.2 Backend

```text
apps/api
├── API versionnée
├── authentification et sessions
├── RBAC / ABAC
├── validation stricte des entrées
├── services métier
├── connecteurs externes
├── file de tâches asynchrones
├── antivirus / contrôle de fichiers
├── audit
└── observabilité
```

### 9.3 Données et recherche

```text
data/
├── PostgreSQL : données transactionnelles
├── object storage privé : documents et pièces jointes
├── moteur de recherche : index public et filtrage
├── cache : données non sensibles
├── queue : import, OCR, export, notifications
└── sauvegardes chiffrées
```

### 9.4 Déploiement

- Environnements séparés : local, test, staging, production.
- Infrastructure déclarative.
- CI/CD avec revue obligatoire.
- Secrets dans un gestionnaire de secrets.
- Logs centralisés et sans données sensibles.
- CDN pour les ressources publiques.
- WAF et protection contre les abus.
- Sauvegardes et plan de reprise.

---

## 10. Sécurité frontend

### 10.1 Principes

- Ne jamais faire confiance au navigateur.
- Toute validation frontend doit être répétée côté backend.
- Ne jamais placer de secret dans le code client.
- Ne jamais exposer de clé privée, clé d’administration ou credential de base de données.
- Minimiser les données envoyées au navigateur.

### 10.2 Authentification

- Utiliser un fournisseur d’identité éprouvé ou un système conforme aux standards.
- Mots de passe stockés uniquement sous forme de hash robuste si une gestion interne existe.
- MFA proposé au minimum pour administrateurs et encadreurs.
- Sessions courtes et renouvellement contrôlé.
- Cookies `HttpOnly`, `Secure`, `SameSite` pour les sessions web.
- Rotation et révocation des sessions.
- Protection contre l’énumération des comptes.
- Messages d’erreur génériques lors de la connexion.

### 10.3 XSS et injection

- Échapper le contenu affiché.
- Éviter le HTML brut et les composants dangereux.
- Nettoyer le contenu riche avec une liste blanche stricte.
- Ajouter une Content Security Policy adaptée.
- Interdire les scripts inline non nécessaires.
- Valider les URLs avant affichage.
- Désinfecter les noms de fichiers et titres affichés.

### 10.4 CSRF et clics détournés

- Utiliser des cookies SameSite.
- Ajouter une protection CSRF lorsque nécessaire.
- Ne pas modifier une donnée par une requête GET.
- Ajouter `frame-ancestors` ou `X-Frame-Options`.
- Confirmer les actions sensibles.

### 10.5 Stockage local

- Ne pas stocker de token sensible dans `localStorage` sans justification forte.
- Chiffrer les données privées hors ligne.
- Effacer les données à la déconnexion selon la politique définie.
- Limiter le cache des documents confidentiels.
- Prévoir l’effacement à distance lorsque le risque le justifie.

### 10.6 Upload frontend

- Limiter taille, nombre et type de fichiers.
- Ne jamais se fier uniquement à l’extension.
- Afficher les règles de confidentialité avant l’envoi.
- Prévenir si le document sera partagé.
- Utiliser un upload direct vers un stockage privé avec URL temporaire.

### 10.7 Accessibilité et résilience

- Navigation clavier.
- Contraste suffisant.
- Labels explicites.
- Messages d’erreur compréhensibles.
- Écrans utilisables sur petits appareils.
- Compression et chargement progressif.
- États offline et reprise après coupure.

---

## 11. Sécurité backend

### 11.1 API

- API versionnée.
- Validation avec schémas stricts.
- Limitation de débit par IP, compte, organisation et endpoint.
- Pagination obligatoire.
- Taille maximale des requêtes.
- Timeouts sur appels externes.
- Idempotence pour les opérations répétées.
- CORS limité aux domaines connus.
- Headers de sécurité.
- Réponses ne révélant pas les détails internes.

### 11.2 Autorisation

Le backend doit vérifier à chaque requête :

1. L’identité de l’utilisateur.
2. Le rôle.
3. L’organisation ou le tenant.
4. La propriété de la ressource.
5. Le niveau d’accès au projet.
6. L’état de la ressource.

Ne jamais déduire l’autorisation d’un identifiant transmis par le client.

### 11.3 Multi-tenant

Toutes les entités sensibles doivent être rattachées à un tenant lorsque nécessaire :

```text
tenant_id
organization_id
created_by
updated_by
```

Règles :

- Aucun accès inter-tenant.
- Filtrage systématique dans le service métier.
- Tests dédiés d’isolation.
- Les exports et recherches doivent respecter le tenant.
- Les administrateurs d’une organisation ne voient que leur périmètre.

### 11.4 Gestion des fichiers

- Stockage privé par défaut.
- URLs signées à durée courte.
- Antivirus et analyse de type réel.
- Blocage des fichiers exécutables.
- Limite de taille et de nombre de pages selon le service.
- OCR dans un environnement isolé.
- Suppression des métadonnées sensibles lorsque nécessaire.
- Quarantaine avant publication.
- Journalisation des téléchargements sensibles.

### 11.5 Webhooks et intégrations

- Vérifier signatures et timestamps.
- Rejeter les événements anciens ou rejoués.
- Utiliser des secrets distincts par intégration.
- Ne jamais faire confiance aux données externes sans validation.
- Journaliser l’échec sans exposer les secrets.

### 11.6 Tâches et workers

- Files séparées pour tâches publiques et privées.
- Retries limités avec backoff.
- Idempotence.
- Validation avant traitement.
- Isolation des tâches d’OCR, conversion et IA.
- Protection contre les fichiers malveillants et les prompts malveillants dans les documents.

### 11.7 Logs et audit

Journaliser :

- Connexions et échecs.
- Changements de rôles.
- Accès aux projets privés.
- Téléchargements sensibles.
- Exports.
- Partages.
- Suppressions.
- Modérations.
- Changements de licences.
- Actions d’administration.

Ne jamais journaliser :

- Mots de passe.
- Tokens.
- Clés API.
- Contenu complet d’un mémoire privé dans un log.
- Données personnelles inutiles.

---

## 12. Sécurité de la base de données

### 12.1 Principes

- Base non exposée directement à Internet.
- Comptes séparés pour migration, application, lecture et administration.
- Principe du moindre privilège.
- Chiffrement en transit et au repos.
- Sauvegardes chiffrées et testées.
- Migrations versionnées et relues.
- Aucune donnée de production dans les environnements de développement.

### 12.2 Modèle de données minimal

```text
users
profiles
organizations
oorganization_members
academic_programs
subjects
resources
resource_sources
resource_licenses
resource_tags
resource_reports
research_projects
research_project_members
thesis_sections
thesis_versions
literature_notes
citations
bibliographies
comments
submissions
notifications
audit_logs
```

### 12.3 Row-Level Security

Si PostgreSQL/Supabase est utilisé :

- Activer RLS pour toutes les tables exposées.
- Créer des politiques explicites pour chaque opération.
- Tester lecture, insertion, modification et suppression.
- Ne jamais laisser une politique générale `true` en production.
- Utiliser le rôle serveur uniquement côté backend sécurisé.
- Vérifier l’appartenance au projet et au tenant.

Exemples de règles conceptuelles :

```text
Un étudiant lit ses propres projets.
Un encadreur lit uniquement les projets qui lui sont partagés.
Un contributeur modifie uniquement ses soumissions en attente.
Une ressource publique publiée peut être lue publiquement.
Une ressource privée n'est lisible que par les membres autorisés.
```

### 12.4 Protection des données

- Minimiser les données collectées.
- Séparer identité, contenu académique et métriques.
- Chiffrer les champs très sensibles si nécessaire.
- Masquer ou pseudonymiser les données pour analytics.
- Définir une durée de conservation.
- Prévoir export, rectification et suppression selon la loi applicable.
- Ne pas publier un mémoire sans consentement explicite.

### 12.5 Intégrité et concurrence

- Clés étrangères.
- Contraintes d’unicité.
- Contraintes de statut.
- Transactions pour les modifications liées.
- Verrouillage ou contrôle de version pour l’éditeur.
- Protection contre les doublons lors des imports.
- Soft delete pour les ressources faisant l’objet d’un audit, avec purge selon politique.

### 12.6 Requêtes

- Requêtes paramétrées ou ORM correctement utilisé.
- Interdiction de concaténer des paramètres utilisateur dans SQL.
- Limites et pagination obligatoires.
- Index adaptés aux requêtes fréquentes.
- Tests de performance sur les recherches.
- Alertes sur requêtes lentes.

---

## 13. Sécurité de la recherche et de l’IA

### 13.1 Recherche

- Échapper ou paramétrer les requêtes.
- Limiter les opérateurs avancés.
- Éviter l’exposition de données privées dans l’index public.
- Réindexer après changement de visibilité.
- Supprimer rapidement les ressources retirées.
- Ne pas indexer les commentaires privés, brouillons ou documents confidentiels.

### 13.2 Prompt injection

Les documents importés peuvent contenir des instructions malveillantes destinées à l’IA.

Mesures :

- Traiter le document comme une donnée, jamais comme une instruction système.
- Séparer instructions, contenu et métadonnées.
- Limiter les outils disponibles pour chaque tâche.
- Ne jamais permettre à un document d’exécuter une action.
- Vérifier les sources avant génération.
- Journaliser les appels IA sans exposer le contenu privé.
- Ne pas envoyer un mémoire privé à un fournisseur externe sans consentement et contrat approprié.

### 13.3 Données envoyées aux fournisseurs IA

Avant tout appel externe :

- Identifier les données envoyées.
- Anonymiser lorsque possible.
- Obtenir le consentement nécessaire.
- Vérifier la conservation et la réutilisation par le fournisseur.
- Prévoir une option sans traitement externe pour les projets confidentiels.
- Afficher clairement les limites de l’assistance automatisée.

---

## 14. Internationalisation et déploiement mondial

### 14.1 Langues

Prévoir dès le départ :

- Français.
- Anglais.
- Portugais.
- Arabe selon les marchés.
- Architecture prête pour langues locales.

Ne jamais coder les textes directement dans les composants.

### 14.2 Données régionales

- Pays avec codes normalisés.
- Fuseaux horaires en IANA.
- Formats de date et nombre localisés.
- Devises séparées du montant.
- Formats d’établissement configurables.
- Programmes éducatifs versionnés par pays et année.
- Normes de citation configurables.

### 14.3 Connectivité

- PWA installable.
- Cache limité et chiffré pour données privées.
- Compression Brotli/Gzip.
- Images adaptées.
- Pagination et chargement progressif.
- Synchronisation différée.
- Reprise après interruption.
- Mode consultation hors ligne pour ressources autorisées.

### 14.4 Scalabilité

- Stateless backend.
- Files de tâches asynchrones.
- Cache distribué.
- Réplication de lecture lorsque nécessaire.
- Partitionnement ou archivage à grande échelle.
- Stockage objet pour les fichiers.
- Moteur de recherche séparé de la base transactionnelle.
- CDN pour les contenus publics.

---

## 15. Protection des mineurs et des étudiants vulnérables

Si la plateforme accueille des mineurs :

- Collecter le minimum de données.
- Adapter les paramètres de profil.
- Limiter les messages privés.
- Prévoir signalement et blocage.
- Modérer les espaces communautaires.
- Protéger les images et informations personnelles.
- Obtenir les consentements requis selon le pays.
- Prévoir un mécanisme de contact responsable.

La plateforme doit respecter les lois applicables dans chaque pays ciblé. Une analyse juridique locale est nécessaire avant le lancement commercial.

---

## 16. Tests obligatoires

### 16.1 Tests fonctionnels

- Inscription et connexion.
- Réinitialisation de mot de passe.
- Recherche et filtres.
- Favoris et collections.
- Soumission et modération.
- Création de projet.
- Édition et export.
- Citations et bibliographie.
- Invitation d’un encadreur.
- Commentaires et validations.

### 16.2 Tests de sécurité

- Contrôle d’accès horizontal : utilisateur A ne lit pas les données de B.
- Contrôle d’accès vertical : étudiant ne peut pas devenir administrateur.
- Isolation inter-tenant.
- XSS stockée et réfléchie.
- CSRF.
- Injection SQL.
- Upload de fichiers dangereux.
- Path traversal.
- Brute force.
- Abuse de pagination et filtres.
- Fuite via logs, exports et recherche.
- Vérification de révocation des sessions.

### 16.3 Tests techniques

- Unitaires.
- Intégration.
- End-to-end.
- Charge et performance.
- Offline et reprise réseau.
- Compatibilité mobile.
- Accessibilité.
- Migrations et restauration de sauvegarde.

### 16.4 Revue avant production

- Revue de code obligatoire.
- Analyse des dépendances.
- SAST et secret scanning.
- DAST sur staging.
- Vérification des règles RLS.
- Vérification des headers.
- Rapport de threat modeling.
- Plan de rollback.
- Validation de la politique de confidentialité.

---

## 17. Threat model simplifié

| Menace | Impact | Mesure principale |
|---|---|---|
| Vol de compte | Projet et données exposés | MFA, sessions sécurisées, alertes |
| IDOR | Accès au projet d’un autre étudiant | Autorisation côté serveur et RLS |
| Upload malveillant | Compromission ou diffusion de malware | Quarantaine, antivirus, stockage privé |
| XSS | Vol de session ou contenu modifié | Échappement, CSP, sanitisation |
| Fuite de mémoire privé | Atteinte académique et personnelle | Permissions, chiffrement, audit |
| Abus d’API | Coûts et indisponibilité | Rate limiting, quotas, WAF |
| Source illégale | Risque juridique | Licence, provenance, retrait |
| Hallucination IA | Erreur académique | Réponses sourcées, validation humaine |
| Prompt injection | Action ou fuite via document | Isolation des outils et des contextes |
| Ransomware / perte de données | Arrêt et perte de travaux | Backups immuables, restauration testée |

---

## 18. Roadmap

### Phase 0 — Fondation

- Nom, identité et modèle économique.
- Taxonomie initiale.
- Politique de confidentialité et licences.
- Architecture, CI/CD, environnements.
- Authentification et modèle multi-tenant.

### Phase 1 — MVP recherche

- Profil étudiant.
- Catalogue de filières et matières.
- Import manuel et premiers connecteurs.
- Recherche, filtres et fiches.
- Favoris et collections.
- Administration et modération.

### Phase 2 — Bibliothèque

- Notes, annotations et historique.
- Import DOI/BibTeX/RIS.
- Dédoublonnage.
- Vérification des liens.
- Licences et demandes de retrait.

### Phase 3 — Atelier de recherche

- Projet de mémoire.
- Plan et chapitres.
- Fiches de lecture.
- Matrice de littérature.
- Citations et bibliographie.
- Export DOCX/PDF.

### Phase 4 — Encadrement

- Inviter un encadreur.
- Commentaires.
- Versions.
- Soumissions.
- Validation par chapitre.
- Échéances et notifications.

### Phase 5 — Internationalisation

- Français et anglais.
- Pays, institutions et programmes configurables.
- Mode faible connexion.
- Mobile.
- Partenariats africains.
- Documentation et support multilingues.

### Phase 6 — Intelligence documentaire

- Classification assistée.
- Résumés sourcés.
- Contrôles de cohérence.
- Alertes de lacunes et doublons.
- Recommandations personnalisées.
- Toujours avec validation humaine.

---

## 19. MVP exact recommandé

Pour limiter le risque, le premier produit doit contenir :

1. Une filière pilote : informatique.
2. Deux langues : français et anglais.
3. Six types de ressources : cours, articles, livres, thèses, vidéos et exercices.
4. Une recherche avec filtres.
5. Un système de favoris et collections.
6. Un catalogue modéré.
7. Un projet de mémoire simple.
8. Des fiches de lecture.
9. Une bibliographie de base.
10. Un export PDF/Word.
11. Des règles de confidentialité solides.
12. Une architecture prête pour les autres pays et filières.

Ne pas commencer par une indexation mondiale massive. Commencer avec un catalogue limité, propre, vérifié et utile.

---

## 20. Critères d’acceptation du MVP

Le MVP sera considéré fonctionnel si :

- Un étudiant peut créer un compte et choisir sa filière.
- Il peut rechercher une ressource avec au moins trois filtres.
- Chaque ressource affiche son origine et son statut d’accès.
- Un administrateur peut vérifier, publier ou retirer une ressource.
- Un étudiant peut créer une collection privée.
- Il peut créer un projet de recherche privé.
- Il peut ajouter des sources et des fiches de lecture.
- Il peut générer une bibliographie sans source inventée.
- Il peut exporter son projet.
- Un autre utilisateur ne peut pas accéder à son projet sans partage explicite.
- Les fichiers privés ne sont jamais accessibles par URL permanente publique.
- Les actions sensibles sont auditables.
- Les sauvegardes peuvent être restaurées dans un environnement de test.

---

## 21. Indicateurs de réussite

### Acquisition

- Inscriptions par pays.
- Taux de création de profil académique.
- Nombre d’établissements représentés.

### Utilité

- Recherches par utilisateur.
- Taux de clic sur une ressource pertinente.
- Temps jusqu’à la première ressource utile.
- Collections et notes créées.

### Qualité

- Pourcentage de liens fonctionnels.
- Ressources vérifiées.
- Doublons supprimés.
- Signalements traités.
- Exactitude des métadonnées.

### Rédaction

- Projets créés.
- Fiches de lecture terminées.
- Chapitres soumis.
- Corrections réalisées.
- Validations d’encadreur.

### Confiance et sécurité

- Incidents de sécurité.
- Accès refusés correctement.
- Temps de traitement des demandes de retrait.
- Taux de restauration réussie.
- Dépendances vulnérables corrigées.

---

## 22. Checklist de développement

### Avant le code

- [ ] Taxonomie filières/matières définie.
- [ ] Rôles et permissions documentés.
- [ ] Politique de confidentialité préparée.
- [ ] Politique de contenu et retrait préparée.
- [ ] Sources et licences listées.
- [ ] Modèle multi-pays et multi-tenant validé.
- [ ] Threat model initial réalisé.

### À chaque fonctionnalité

- [ ] User story et critères d’acceptation.
- [ ] Schéma de données.
- [ ] Permissions.
- [ ] Validation frontend et backend.
- [ ] Tests unitaires et intégration.
- [ ] Logs utiles mais minimisés.
- [ ] Gestion des erreurs.
- [ ] Accessibilité.
- [ ] Mobile et réseau lent.
- [ ] Documentation.

### Avant mise en production

- [ ] Secrets absents du dépôt.
- [ ] RLS et autorisations testées.
- [ ] Rate limiting actif.
- [ ] Headers de sécurité configurés.
- [ ] Upload sécurisé.
- [ ] Backups chiffrés.
- [ ] Restauration testée.
- [ ] Monitoring et alertes actifs.
- [ ] Plan de rollback.
- [ ] Revue de sécurité.

---

## 23. Conclusion

EduScholar doit être développé comme une infrastructure académique, pas comme une simple page de recherche. Sa valeur repose sur la combinaison de trois piliers :

```text
TROUVER → ORGANISER → PRODUIRE
```

Le moteur trouve les ressources. La bibliothèque les organise. L’atelier de recherche aide l’étudiant à construire un travail documenté et personnel.

La priorité n’est pas d’indexer immédiatement tout Internet. La priorité est de créer un catalogue légal, vérifié et bien classé, puis de bâtir une expérience de recherche et de rédaction fiable.

L’architecture doit être mondiale dès le premier jour : multi-langue, multi-pays, multi-établissements, multi-tenant, compatible mobile et conçue avec une sécurité forte. Le lancement peut cependant rester ciblé sur une filière et quelques pays afin de tester la qualité du produit avant l’expansion.

> Décision recommandée : démarrer par un MVP « recherche académique + bibliothèque + projet de mémoire » pour les étudiants en informatique, en français et en anglais, avec une base technique prête à accueillir l’ensemble des filières et du monde.
