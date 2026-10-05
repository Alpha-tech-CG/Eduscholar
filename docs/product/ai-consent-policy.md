# Politique d'assistance automatisée et de consentement — brouillon

**Date :** 6 octobre 2026
**Statut :** BROUILLON DE TRAVAIL — **à valider juridiquement avant toute activation d'une fonction d'IA**
**Tâche :** B-05
**Références :** cahier §5, §8, §13 ; modèle de menaces M-29 à M-33 ; modèle d'autorisation §5.3

Aucune fonction d'assistance automatisée n'existe dans le MVP de recherche. Cette
politique fixe les règles avant qu'une seule soit construite (Phase 6).

## 1. Principes

1. **L'étudiant reste l'auteur.** L'assistance aide à trouver, comprendre et organiser.
   Elle ne rédige pas le mémoire.
2. **Une source ou rien.** Toute affirmation académique générée est rattachée à une source
   identifiée. Sans source, l'outil le dit.
3. **Le consentement d'abord.** Aucun contenu privé ne quitte la plateforme sans accord
   explicite de son propriétaire.
4. **Transparence.** Ce qui est généré est marqué comme tel.
5. **Validation humaine.** Rien de généré n'est tenu pour fiable sans vérification.

## 2. Ce que l'assistance peut faire

- Classer une ressource par filière et matière.
- Extraire des mots-clés.
- Résumer un document fourni ou légalement accessible.
- Préparer une fiche de lecture, à vérifier.
- Détecter des doublons, des références manquantes ou incomplètes.
- Vérifier la structure d'un document.
- Suggérer des questions et des thèmes.
- Comparer des sources, citations visibles.
- Traduire ou reformuler, avec avertissement.

## 3. Ce que l'assistance ne fait pas

- Inventer une source, un DOI, un auteur ou une citation.
- Présenter une conclusion générée comme un résultat de recherche.
- Produire un mémoire, une thèse ou un chapitre prêt à déposer.
- Résumer une source sans en conserver la référence.
- Traiter un document protégé sans autorisation.
- Masquer son intervention.

Sans source vérifiable, la réponse est : « Je ne dispose pas d'une source vérifiable pour
confirmer ce point. »

## 4. Ce que contient une réponse générée

- Les identifiants des sources utilisées.
- Les passages utilisés, quand c'est possible, avec la page ou la section.
- Un niveau de confiance.
- Un avertissement lorsque les sources sont insuffisantes.
- La mention « généré automatiquement — à vérifier ».

Un DOI ou une référence n'est affiché que s'il correspond à une ressource enregistrée ou
vérifiée auprès d'une source de référence.

## 5. Consentement au traitement externe

| Règle | Détail |
|---|---|
| Granularité | Par projet. Désactivé par défaut. |
| Qui consent | Le propriétaire du projet uniquement. Un encadreur ou un lecteur ne peut pas l'activer. |
| Information préalable | Quelles données partent, vers quel fournisseur, dans quel pays, combien de temps elles y sont conservées, si elles peuvent être réutilisées |
| Forme | Action explicite, jamais une case précochée ; enregistrée avec date et version du texte accepté |
| Retrait | À tout moment, effet immédiat sur les appels suivants |
| Vérification | Par le serveur et la base avant chaque appel, pas par l'interface |
| Nouveau fournisseur ou nouvelles conditions | Nouveau consentement requis |

**Mode confidentiel.** Un projet peut être marqué confidentiel : aucune fonction faisant
appel à un service externe n'y est alors proposée.

**Contenu d'un tiers.** Le consentement du propriétaire ne couvre pas les commentaires de
son encadreur : ils ne sont pas transmis. Les documents de tiers joints au projet ne sont
traités que si leur licence le permet.

## 6. Données transmises

- Le strict nécessaire à la tâche : un passage, pas le projet entier, quand cela suffit.
- Sans nom, adresse, établissement ni identifiant de compte.
- Jamais le journal des appels ne contient le contenu d'un document privé.

## 7. Exigences envers le fournisseur

Avant tout contrat `[À NÉGOCIER et à faire valider par le juriste]` :

- pas d'utilisation des données pour entraîner ses modèles ;
- durée de conservation nulle ou la plus courte possible, connue et affichée ;
- lieu de traitement connu ;
- accord de sous-traitance conforme au droit applicable ;
- suppression sur demande.

Le fournisseur et ses conditions sont listés dans la politique de confidentialité.

## 8. Documents hostiles

Un document peut contenir des instructions destinées à tromper l'outil. En conséquence :

- le contenu d'un document est traité comme une donnée, jamais comme une consigne ;
- l'assistance ne peut déclencher aucune action sur le compte, le projet ou le catalogue ;
- sa sortie est nettoyée comme n'importe quelle saisie d'utilisateur avant affichage.

## 9. Intégrité académique

- L'utilisateur est informé que son établissement peut encadrer ou interdire l'usage
  d'outils automatisés, et qu'il lui revient de respecter ce règlement.
- La plateforme conserve, pour l'utilisateur seulement, l'historique des assistances
  utilisées dans un projet, afin qu'il puisse les déclarer.
- Un établissement partenaire pourra demander la désactivation de l'assistance pour ses
  membres `[À DÉCIDER]`.

## 10. Limites et quotas

Nombre d'usages plafonné par utilisateur et par organisation, plafond global, pour
maîtriser les coûts et prévenir les abus.

## 11. Assistance sans contenu privé

Le classement et l'indexation du **catalogue public** portent sur des ressources publiées
et ne demandent pas de consentement individuel. Ils respectent les licences des
ressources et les conditions des sources.

## Points à traiter par le juriste

1. Validité du consentement, y compris pour un mineur.
2. Contrat et accord de sous-traitance avec le fournisseur.
3. Transfert international des contenus.
4. Obligations de transparence sur les contenus générés dans les pays pilotes.
5. Responsabilité en cas d'erreur d'une réponse générée.
