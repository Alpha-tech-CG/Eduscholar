import type { LegalDocument } from "./types";

// Repris de docs/product/privacy-policy-draft.md (mise à jour du 23 octobre
// 2026), sans l'en-tête de travail, sans les notes destinées à l'équipe ni au
// juriste. Les informations à fournir viennent de `entity.ts`.

export const privacy: LegalDocument = {
  title: "Politique de confidentialité",
  updated: "2026-10-23",
  sections: [
    {
      heading: "1. Qui est responsable",
      blocks: [
        {
          kind: "list",
          items: [
            "Responsable du traitement : {{controllerName}}, {{controllerAddress}}",
            "Contact pour la protection des données : {{dataProtectionContact}}",
            "Autorité de contrôle compétente : {{supervisoryAuthority}}",
          ],
        },
      ],
    },
    {
      heading: "2. Principes",
      blocks: [
        {
          kind: "list",
          ordered: true,
          items: [
            "Nous collectons le minimum nécessaire au service.",
            "Vos travaux — projets, brouillons, notes, fiches de lecture — sont privés. Personne d'autre que vous n'y accède sans un partage que vous avez fait vous-même.",
            "Votre profil n'est pas public. Vous choisissez ce que vous rendez visible.",
            "Nous ne vendons pas vos données et ne les utilisons pas pour de la publicité ciblée.",
            "Vos travaux ne servent pas à entraîner des modèles d'intelligence artificielle.",
            "Aucun document privé n'est envoyé à un service externe d'intelligence artificielle sans votre accord explicite, projet par projet.",
          ],
        },
      ],
    },
    {
      heading: "3. Données collectées",
      blocks: [
        {
          kind: "table",
          caption: "Données collectées, leur finalité et leur caractère obligatoire",
          head: ["Catégorie", "Données", "Pourquoi", "Obligatoire"],
          rows: [
            ["Compte", "Adresse électronique, mot de passe (stocké haché par le fournisseur d'authentification), second facteur le cas échéant", "Vous identifier et protéger le compte", "Oui"],
            ["Profil académique", "Pays, niveau, filière, spécialité, langue préférée", "Adapter la recherche et les suggestions", "Pays, niveau et filière"],
            ["Profil complémentaire", "Établissement, matières suivies, objectifs, nom d'affichage", "Personnaliser ; vous identifier auprès d'un encadreur", "Non"],
            ["Bibliothèque", "Favoris, collections, notes, annotations, historique de consultation", "Le service lui-même", "Non"],
            ["Travaux", "Projets, sections, versions, fiches de lecture, citations, fichiers joints", "Le service lui-même", "Non"],
            ["Collaboration", "Invitations, commentaires, tâches, décisions de l'encadreur", "Le suivi du mémoire", "Non"],
            ["Contributions", "Ressources soumises, licence déclarée, signalements", "Constituer et modérer le catalogue", "Non"],
            ["Sécurité", "Journal des connexions et des actions sensibles, adresse IP, type d'appareil", "Détecter les abus, enquêter sur un incident", "Oui"],
            ["Mesure d'usage", "Statistiques agrégées, sans identification individuelle", "Améliorer le produit", "Non"],
          ],
        },
        {
          kind: "paragraph",
          text: "Nous ne collectons pas : données de santé, opinions, religion, origine, données biométriques, géolocalisation précise, carnet d'adresses.",
        },
      ],
    },
    {
      heading: "4. Ce qui est visible, et par qui",
      blocks: [
        {
          kind: "table",
          caption: "Qui voit quelle donnée",
          head: ["Donnée", "Visible par"],
          rows: [
            ["Profil", "Vous seul, sauf les champs que vous publiez"],
            ["Nom d'affichage", "Les personnes avec qui vous partagez un projet"],
            ["Bibliothèque, notes, historique", "Vous seul"],
            ["Projet de recherche", "Vous, et les personnes que vous avez invitées, dans la limite que vous fixez"],
            ["Ressource que vous soumettez", "Les modérateurs, puis le public si elle est publiée"],
            ["Signalement", "Les modérateurs ; l'organisation visée ne voit pas votre identité"],
          ],
        },
        {
          kind: "paragraph",
          text: "Les administrateurs de la plateforme, les modérateurs et les administrateurs de votre établissement n'ont pas accès à vos projets, notes et fichiers privés. Votre établissement ne voit que des statistiques agrégées, au-dessus d'un effectif minimal.",
        },
        {
          kind: "paragraph",
          text: "Limite à connaître : les personnes qui administrent techniquement l'infrastructure d'hébergement disposent d'un accès à la base de données. Cet accès est restreint à un nombre minimal de personnes, protégé et tracé.",
        },
      ],
    },
    {
      heading: "5. Assistance automatisée",
      blocks: [
        {
          kind: "list",
          items: [
            "Les fonctions d'assistance sont facultatives et signalées comme telles.",
            "Un projet n'est transmis à un fournisseur externe que si vous avez activé cette option pour ce projet. Vous pouvez la retirer à tout moment.",
            "Un mode sans traitement externe existe pour les projets confidentiels.",
            "Détail : voir la page « Assistance automatisée et consentement ».",
          ],
        },
      ],
    },
    {
      heading: "6. Sous-traitants et services tiers",
      blocks: [
        {
          kind: "table",
          caption: "Sous-traitants et services tiers, données concernées et lieu de traitement",
          head: ["Rôle", "Fournisseur", "Données concernées", "Lieu de traitement"],
          rows: [
            ["Hébergement de l'application", "Vercel", "Toutes les requêtes adressées à l'application, journaux d'accès", "Union européenne"],
            ["Base de données, authentification, fichiers", "Supabase", "Compte, profil, travaux et toutes les données du service", "Union européenne (Paris)"],
            ["Envoi des courriels", "{{mailProvider}}", "Adresse électronique et contenu des courriels du service (confirmation, avis de sécurité, invitations, notifications)", "{{mailProviderLocation}}"],
            ["Défi anti-robot", "Cloudflare (Turnstile)", "Adresse IP et signaux techniques du navigateur, sur les pages de connexion, d'inscription et de revérification du mot de passe", "Réseau de Cloudflare"],
            ["Contrôle des mots de passe compromis", "Have I Been Pwned (Pwned Passwords)", "Les cinq premiers caractères de l'empreinte du mot de passe, rien d'autre : ni le mot de passe, ni l'adresse, ni aucune donnée personnelle", "Sans objet : aucune donnée personnelle n'est transmise"],
            ["Assistance automatisée", "Aucun", "L'assistance actuelle est calculée par la plateforme elle-même, sans modèle de langage ni service externe : aucun contenu ne part vers un tiers", "Sans objet"],
          ],
        },
      ],
    },
    {
      heading: "7. Durées de conservation",
      blocks: [
        {
          kind: "table",
          caption: "Durées de conservation des données",
          head: ["Donnée", "Durée"],
          rows: [
            ["Compte et profil", "Tant que le compte existe"],
            ["Compte dont l'adresse n'a jamais été confirmée", "7 jours après l'inscription"],
            ["Travaux et bibliothèque", "Tant que le compte existe ; un projet supprimé est purgé après 30 jours"],
            ["Compte inactif", "{{inactiveAccountRetention}}"],
            ["Journal de sécurité", "{{securityLogRetention}}"],
            ["Sauvegardes", "{{backupRetention}}"],
            ["Décisions de modération et demandes de retrait", "{{moderationRecordRetention}}"],
          ],
        },
      ],
    },
    {
      heading: "8. Vos droits",
      blocks: [
        { kind: "paragraph", text: "Depuis votre compte ou en nous écrivant, vous pouvez :" },
        {
          kind: "list",
          items: [
            "accéder à vos données et en obtenir une copie dans un format réutilisable : depuis « Mon compte », après avoir saisi votre mot de passe. La copie contient votre profil, votre bibliothèque, vos projets de recherche (sources, fiches de lecture, sections, tâches, versions soumises, y compris les projets supprimés en attente d'effacement), vos commentaires, vos propositions et vos signalements, vos organisations et les événements de sécurité de votre compte. Elle dit elle-même ce qu'elle ne contient pas (notifications, documents des versions soumises, déclarations jointes aux propositions). Chaque copie est notée dans le journal de sécurité de votre compte ;",
            "corriger votre profil ;",
            "supprimer un projet, une note, ou votre compte entier ;",
            "retirer un consentement (assistance automatisée, visibilité du profil, publication) ;",
            "vous opposer à un traitement ou en demander la limitation.",
          ],
        },
        {
          kind: "paragraph",
          text: "Effets d'une suppression de compte : vos données privées sont effacées. Une ressource que vous avez publiée dans le catalogue peut y rester, selon la licence que vous lui avez donnée, ou être retirée à votre demande. Le journal de sécurité est conservé sous une forme qui ne vous identifie plus directement.",
        },
        { kind: "paragraph", text: "Délai de réponse : {{rightsResponseDelay}}." },
      ],
    },
    {
      heading: "9. Sécurité",
      blocks: [
        {
          kind: "list",
          items: [
            "Chiffrement des échanges et des données stockées.",
            "Contrôle d'accès appliqué au niveau de la base de données elle-même.",
            "Fichiers privés accessibles uniquement par des liens temporaires.",
            "Second facteur d'authentification obligatoire pour les comptes à privilèges ; des codes de secours, dont seule une empreinte est conservée, permettent de retrouver l'accès à son compte.",
            "Journal des actions sensibles, non modifiable.",
            "Sauvegardes chiffrées, restauration testée.",
          ],
        },
        {
          kind: "paragraph",
          text: "En cas de violation de données vous concernant, nous vous informons ainsi que l'autorité compétente, dans les délais légaux : {{breachNotificationDelay}}.",
        },
      ],
    },
    {
      heading: "10. Mineurs",
      blocks: [
        {
          kind: "paragraph",
          text: "Voir la page « Protection des mineurs ». Tant que la décision d'accueillir des mineurs n'est pas prise, l'inscription est réservée aux personnes majeures selon la loi de leur pays.",
        },
      ],
    },
    {
      heading: "11. Cookies",
      blocks: [
        {
          kind: "list",
          items: [
            "Cookies strictement nécessaires : session et sécurité. Ils ne demandent pas de consentement.",
            "Parmi eux, le témoin es-device : un identifiant aléatoire, illisible par les scripts et valable un an, qui reconnaît votre navigateur pour vous prévenir d'une connexion à votre compte depuis un navigateur inconnu. La base n'en garde qu'une empreinte ; ni adresse IP, ni nom d'appareil, ni lieu ne sont relevés.",
            "Mesure d'usage : sans identification individuelle et sans partage avec des tiers.",
            "Aucun cookie publicitaire.",
          ],
        },
      ],
    },
    {
      heading: "12. Modification de cette politique",
      blocks: [
        {
          kind: "paragraph",
          text: "Toute modification importante est annoncée dans l'application avant son entrée en vigueur.",
        },
      ],
    },
  ],
};
