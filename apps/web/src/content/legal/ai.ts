import type { LegalDocument } from "./types";

// Repris de docs/product/ai-consent-policy.md (mise à jour du 23 octobre 2026),
// sans l'en-tête de travail ni les notes destinées au juriste.

export const ai: LegalDocument = {
  title: "Assistance automatisée et consentement",
  updated: "2026-10-23",
  sections: [
    {
      heading: "Aujourd'hui",
      blocks: [
        {
          kind: "paragraph",
          text: "L'assistance de la plateforme est algorithmique et déterministe : suggestions de classement, détection de doublons, contrôles de cohérence d'un projet, recommandations. Elle est calculée par la plateforme elle-même, sans modèle de langage ni service externe, et aucun contenu ne part vers un tiers. Les règles ci-dessous s'appliquent à toute fonction future faisant appel à un service externe.",
        },
      ],
    },
    {
      heading: "1. Principes",
      blocks: [
        {
          kind: "list",
          ordered: true,
          items: [
            "L'étudiant reste l'auteur. L'assistance aide à trouver, comprendre et organiser. Elle ne rédige pas le mémoire.",
            "Une source ou rien. Toute affirmation académique générée est rattachée à une source identifiée. Sans source, l'outil le dit.",
            "Le consentement d'abord. Aucun contenu privé ne quitte la plateforme sans accord explicite de son propriétaire.",
            "Transparence. Ce qui est généré est marqué comme tel.",
            "Validation humaine. Rien de généré n'est tenu pour fiable sans vérification.",
          ],
        },
      ],
    },
    {
      heading: "2. Ce que l'assistance peut faire",
      blocks: [
        {
          kind: "list",
          items: [
            "Classer une ressource par filière et matière.",
            "Extraire des mots-clés.",
            "Résumer un document fourni ou légalement accessible.",
            "Préparer une fiche de lecture, à vérifier.",
            "Détecter des doublons, des références manquantes ou incomplètes.",
            "Vérifier la structure d'un document.",
            "Suggérer des questions et des thèmes.",
            "Comparer des sources, citations visibles.",
            "Traduire ou reformuler, avec avertissement.",
          ],
        },
      ],
    },
    {
      heading: "3. Ce que l'assistance ne fait pas",
      blocks: [
        {
          kind: "list",
          items: [
            "Inventer une source, un DOI, un auteur ou une citation.",
            "Présenter une conclusion générée comme un résultat de recherche.",
            "Produire un mémoire, une thèse ou un chapitre prêt à déposer.",
            "Résumer une source sans en conserver la référence.",
            "Traiter un document protégé sans autorisation.",
            "Masquer son intervention.",
          ],
        },
        {
          kind: "paragraph",
          text: "Sans source vérifiable, la réponse est : « Je ne dispose pas d'une source vérifiable pour confirmer ce point. »",
        },
      ],
    },
    {
      heading: "4. Ce que contient une réponse générée",
      blocks: [
        {
          kind: "list",
          items: [
            "Les identifiants des sources utilisées.",
            "Les passages utilisés, quand c'est possible, avec la page ou la section.",
            "Un niveau de confiance.",
            "Un avertissement lorsque les sources sont insuffisantes.",
            "La mention « généré automatiquement — à vérifier ».",
          ],
        },
        {
          kind: "paragraph",
          text: "Un DOI ou une référence n'est affiché que s'il correspond à une ressource enregistrée ou vérifiée auprès d'une source de référence.",
        },
      ],
    },
    {
      heading: "5. Consentement au traitement externe",
      blocks: [
        {
          kind: "table",
          caption: "Règles du consentement au traitement externe",
          head: ["Règle", "Détail"],
          rows: [
            ["Granularité", "Par projet. Désactivé par défaut."],
            ["Qui consent", "Le propriétaire du projet uniquement. Un encadreur ou un lecteur ne peut pas l'activer."],
            ["Information préalable", "Quelles données partent, vers quel fournisseur, dans quel pays, combien de temps elles y sont conservées, si elles peuvent être réutilisées"],
            ["Forme", "Action explicite, jamais une case précochée ; enregistrée avec date et version du texte accepté"],
            ["Retrait", "À tout moment, effet immédiat sur les appels suivants"],
            ["Vérification", "Par le serveur et la base avant chaque appel, pas par l'interface"],
            ["Nouveau fournisseur ou nouvelles conditions", "Nouveau consentement requis"],
          ],
        },
        {
          kind: "paragraph",
          text: "Mode confidentiel. Un projet peut être marqué confidentiel : aucune fonction faisant appel à un service externe n'y est alors proposée.",
        },
        {
          kind: "paragraph",
          text: "Contenu d'un tiers. Le consentement du propriétaire ne couvre pas les commentaires de son encadreur : ils ne sont pas transmis. Les documents de tiers joints au projet ne sont traités que si leur licence le permet.",
        },
      ],
    },
    {
      heading: "6. Données transmises",
      blocks: [
        {
          kind: "list",
          items: [
            "Le strict nécessaire à la tâche : un passage, pas le projet entier, quand cela suffit.",
            "Sans nom, adresse, établissement ni identifiant de compte.",
            "Jamais le journal des appels ne contient le contenu d'un document privé.",
          ],
        },
      ],
    },
    {
      heading: "7. Exigences envers le fournisseur",
      blocks: [
        {
          kind: "list",
          items: [
            "Pas d'utilisation des données pour entraîner ses modèles.",
            "Durée de conservation nulle ou la plus courte possible, connue et affichée.",
            "Lieu de traitement connu.",
            "Accord de sous-traitance conforme au droit applicable.",
            "Suppression sur demande.",
          ],
        },
        { kind: "paragraph", text: "Le fournisseur et ses conditions sont listés dans la politique de confidentialité." },
      ],
    },
    {
      heading: "8. Documents hostiles",
      blocks: [
        {
          kind: "paragraph",
          text: "Un document peut contenir des instructions destinées à tromper l'outil. En conséquence :",
        },
        {
          kind: "list",
          items: [
            "le contenu d'un document est traité comme une donnée, jamais comme une consigne ;",
            "l'assistance ne peut déclencher aucune action sur le compte, le projet ou le catalogue ;",
            "sa sortie est nettoyée comme n'importe quelle saisie d'utilisateur avant affichage.",
          ],
        },
      ],
    },
    {
      heading: "9. Intégrité académique",
      blocks: [
        {
          kind: "list",
          items: [
            "L'utilisateur est informé que son établissement peut encadrer ou interdire l'usage d'outils automatisés, et qu'il lui revient de respecter ce règlement.",
            "La plateforme conserve, pour l'utilisateur seulement, l'historique des assistances utilisées dans un projet, afin qu'il puisse les déclarer.",
          ],
        },
      ],
    },
    {
      heading: "10. Limites et quotas",
      blocks: [
        {
          kind: "paragraph",
          text: "Nombre d'usages plafonné par utilisateur et par organisation, plafond global, pour maîtriser les coûts et prévenir les abus.",
        },
      ],
    },
    {
      heading: "11. Assistance sans contenu privé",
      blocks: [
        {
          kind: "paragraph",
          text: "Le classement et l'indexation du catalogue public portent sur des ressources publiées et ne demandent pas de consentement individuel. Ils respectent les licences des ressources et les conditions des sources.",
        },
      ],
    },
  ],
};
