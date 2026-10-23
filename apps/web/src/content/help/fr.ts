import type { HelpContent } from "./types";

// Aide en français. Chaque phrase décrit ce que fait l'application aujourd'hui :
// aucune promesse qu'elle ne tient pas.

export const fr: HelpContent = {
  index: {
    title: "Aide",
    intro:
      "Comment utiliser EduScholar : votre compte, le catalogue, votre bibliothèque, votre projet de recherche, le partage avec un encadreur, la connexion faible et vos données.",
    topicsHeading: "Sujets",
    note:
      "Ces pages décrivent la plateforme telle qu'elle fonctionne aujourd'hui. Elle est encore en construction : certaines fonctions évolueront.",
  },
  backToIndex: "Retour à l'aide",
  relatedHeading: "Pour aller plus loin",
  topics: {
    account: {
      title: "Créer son compte et sécuriser sa connexion",
      summary: "Inscription, confirmation de l'adresse, profil, mot de passe oublié et validation en deux étapes.",
      sections: [
        {
          heading: "Créer un compte",
          paragraphs: [
            "Choisissez une adresse électronique et un mot de passe d'au moins douze caractères, avec des lettres et des chiffres. Un mot de passe trop courant, ou qui figure dans des fuites de données connues, est refusé. Une vérification anti-robot peut vous être demandée.",
            "Un message est envoyé à l'adresse indiquée. Ouvrez le lien qu'il contient pour activer votre compte, puis connectez-vous.",
            "À la première connexion, vous complétez un profil minimal : pays, niveau d'études et filière, et la déclaration que vous avez l'âge requis dans votre pays. Ces informations adaptent la recherche ; elles ne sont visibles que de vous.",
          ],
          links: [
            { href: "/sign-up", label: "Créer un compte" },
            { href: "/sign-in", label: "Se connecter" },
          ],
        },
        {
          heading: "Mot de passe oublié",
          paragraphs: [
            "Depuis la page de connexion, demandez un lien pour choisir un nouveau mot de passe. Le message n'arrive que si un compte existe pour cette adresse. Une fois le mot de passe changé, tous vos appareils sont déconnectés.",
          ],
          links: [{ href: "/forgot-password", label: "Mot de passe oublié" }],
        },
        {
          heading: "La validation en deux étapes",
          paragraphs: [
            "Elle demande, en plus du mot de passe, un code à six chiffres affiché par une application d'authentification installée sur votre téléphone. Activez-la depuis « Sécurité du compte » : scannez le code affiché, ou saisissez la clé à la main, puis le premier code.",
            "Générez aussitôt vos dix codes de secours, et gardez-les ailleurs que sur ce téléphone. Chacun ne sert qu'une fois. Si vous perdez l'application, un code de secours vous rend l'accès ; la validation en deux étapes est alors désactivée et vos autres sessions sont fermées : réactivez-la avec votre nouvel appareil.",
            "Les rôles de modération et d'administration exigent la validation en deux étapes.",
          ],
          links: [{ href: "/account/security", label: "Sécurité du compte" }],
        },
      ],
    },
    search: {
      title: "Chercher dans le catalogue et comprendre une fiche",
      summary: "La recherche, ses filtres, et ce que disent la provenance, la licence et le statut d'accès d'une fiche.",
      sections: [
        {
          heading: "Chercher",
          paragraphs: [
            "La recherche est ouverte aux comptes dont le profil est complété. Saisissez des mots, puis affinez par type de document, langue, statut d'accès, niveau ou matière de votre filière.",
            "Seules les fiches publiées par la modération apparaissent : une proposition en cours d'examen n'est montrée à personne.",
            "La page « Recommandations » propose des fiches d'après votre seul profil et, si vous le choisissez, d'après les sources de l'un de vos projets. Elle ne se sert jamais de l'activité des autres personnes.",
          ],
          links: [
            { href: "/search", label: "Rechercher dans le catalogue" },
            { href: "/recommendations", label: "Recommandations" },
          ],
        },
        {
          heading: "Ce que dit une fiche",
          paragraphs: [
            "EduScholar décrit des documents ; il ne les héberge pas. Le lien officiel mène au site de la source du document.",
            "« Origine de la fiche » dit d'où viennent ses informations : une source reconnue interrogée par la plateforme, ou une proposition d'un utilisateur. La fiche indique aussi la date de sa dernière vérification, et les champs que la modération a corrigés depuis l'import.",
            "La licence dit ce que vous pouvez faire du document. Vérifiez-la toujours avant de le réutiliser, de le copier ou de le diffuser.",
            "Le statut d'accès dit comment le document se consulte : accès ouvert, lien gratuit, aperçu seulement, accès par un établissement, payant, ou inconnu quand la source ne le dit pas.",
          ],
        },
        {
          heading: "Proposer une ressource",
          paragraphs: [
            "Vous pouvez proposer un document au catalogue avec son lien officiel et sa licence. La modération l'examine avant toute publication ; vous suivez son état dans « Mes contributions ».",
          ],
          links: [
            { href: "/contribute", label: "Proposer une ressource" },
            { href: "/contributions", label: "Mes contributions" },
          ],
        },
      ],
    },
    library: {
      title: "Sa bibliothèque",
      summary: "Favoris et collections : garder et ranger les fiches qui vous servent.",
      sections: [
        {
          heading: "Favoris et collections",
          paragraphs: [
            "Depuis la page d'une fiche, ajoutez-la à vos favoris ou rangez-la dans une collection que vous avez créée. Votre bibliothèque est privée : vous seul la voyez.",
            "Supprimer une collection ne supprime pas les fiches : elles restent au catalogue.",
          ],
          links: [{ href: "/library", label: "Ma bibliothèque" }],
        },
      ],
    },
    project: {
      title: "Son projet de recherche",
      summary: "Fiche du projet, plan et rédaction, sources et fiches de lecture, bibliographie et export.",
      sections: [
        {
          heading: "La fiche du projet",
          paragraphs: [
            "Un projet est privé par défaut. Sa fiche rassemble le contexte, la problématique, la question principale, les hypothèses, les objectifs, la méthodologie et l'échéance.",
          ],
          links: [{ href: "/projects", label: "Mes projets de recherche" }],
        },
        {
          heading: "Le plan et la rédaction",
          paragraphs: [
            "Le plan range chapitres, sections et sous-sections dans l'ordre du document. Chaque section se rédige en texte simple, trente mille caractères au plus ; le texte s'enregistre tout seul pendant que vous écrivez.",
            "Dans chaque section, indiquez les sources qu'elle cite, avec leurs pages.",
          ],
        },
        {
          heading: "Les sources et les fiches de lecture",
          paragraphs: [
            "Une source est saisie par vous, ou reprise d'une fiche du catalogue. La plateforme n'en invente aucune.",
            "Pour chaque source, une fiche de lecture garde votre analyse : problème, concepts, méthode, résultats, limites, citation utile. La matrice de littérature les compare côte à côte. Vos fiches de lecture ne sont lues que par vous.",
          ],
        },
        {
          heading: "La bibliographie, le document et l'export",
          paragraphs: [
            "La bibliographie est mise en forme selon la norme APA (7e édition, forme de base), à partir des sources telles que vous les avez saisies. Rien n'est deviné : une date absente donne la mention « s. d. » et un signalement.",
            "Le document réunit le titre, la table des matières, les sections rédigées et la bibliographie, en français ou en anglais. Il s'imprime ou s'enregistre en PDF depuis le navigateur, et se télécharge en Word (.docx) ou en Markdown (.md).",
            "Les contrôles de cohérence signalent des points de forme à vérifier : section sans citation, source jamais citée, source incomplète, échéance proche. Ils n'évaluent pas le fond du travail.",
          ],
        },
      ],
    },
    sharing: {
      title: "Partager avec un encadreur",
      summary: "Inviter une personne, choisir ce qu'elle lit, recevoir ses commentaires et ses décisions.",
      sections: [
        {
          heading: "Inviter",
          paragraphs: [
            "Depuis la page « Gérer le partage » de votre projet, saisissez l'adresse de la personne. Elle reçoit un courriel avec un lien valable sept jours, et doit se connecter avec cette même adresse, confirmée, pour accepter : le lien seul ne donne aucun accès.",
            "Deux rôles existent : « Encadrement » et « Lecture seule ». Personne ne peut modifier votre texte. L'encadrement commente les sections, rend une décision sur les versions que vous lui soumettez et propose des tâches.",
            "Vous pouvez limiter l'accès à certaines sections. Vos fiches de lecture ne sont jamais partagées.",
          ],
          links: [
            { href: "/projects", label: "Mes projets de recherche" },
            { href: "/shared", label: "Projets partagés avec moi" },
          ],
        },
        {
          heading: "Le lien de partage",
          paragraphs: [
            "Un lien de partage ne donne aucun droit et ne dit rien du projet : la personne qui l'ouvre peut seulement demander à le suivre, et rien ne lui est ouvert tant que vous n'avez pas accepté. Il vaut sept jours.",
          ],
        },
        {
          heading: "Versions et retrait",
          paragraphs: [
            "Une version soumise est une photographie de votre document : elle ne change plus ensuite. L'encadrement la lit et rend sa décision, que vous retrouvez dans l'historique.",
            "Vous retirez une personne quand vous voulez, avec effet immédiat ; elle peut aussi quitter le projet d'elle-même.",
          ],
          links: [{ href: "/notifications", label: "Notifications" }],
        },
      ],
    },
    offline: {
      title: "La connexion faible et le mode hors ligne",
      summary: "Ce qui fonctionne quand le réseau manque, et ce qui ne fonctionne pas.",
      sections: [
        {
          heading: "Ce qui fonctionne",
          paragraphs: [
            "EduScholar s'installe comme une application depuis le navigateur. Les fichiers de l'interface sont gardés sur l'appareil pour se charger plus vite.",
            "Si le réseau manque, un bandeau le signale, et une page hors ligne s'affiche à la place d'une page qui ne peut pas être chargée.",
            "Pendant la rédaction d'une section, si l'enregistrement échoue faute de réseau, votre texte reste dans la page et un nouvel essai a lieu automatiquement. Ne fermez pas la page avant que l'enregistrement soit confirmé.",
          ],
        },
        {
          heading: "Ce qui ne fonctionne pas",
          paragraphs: [
            "Aucune donnée privée n'est gardée sur l'appareil : ni votre projet, ni votre bibliothèque, ni votre compte. Sans réseau, ces pages ne s'ouvrent pas, et rien de ce que vous saisissez ne peut être enregistré.",
            "Sur un appareil partagé, déconnectez-vous à la fin : rien de privé ne reste alors sur l'appareil.",
          ],
        },
      ],
    },
    data: {
      title: "Ses données personnelles",
      summary: "Télécharger une copie de ses données, et supprimer son compte.",
      sections: [
        {
          heading: "Télécharger une copie",
          paragraphs: [
            "Depuis votre compte, téléchargez une copie de vos données dans un fichier JSON, lisible par un programme. Votre mot de passe est redemandé, et chaque téléchargement est noté dans le journal de sécurité de votre compte.",
            "La copie contient notamment votre profil, votre bibliothèque, vos projets avec leurs sources, fiches de lecture, sections, tâches et versions soumises, vos commentaires, vos propositions au catalogue, vos signalements, vos organisations et les événements de sécurité de votre compte. Elle dit elle-même ce qu'elle ne contient pas, comme les notifications ou les documents des versions soumises.",
          ],
          links: [{ href: "/account/export", label: "Télécharger mes données" }],
        },
        {
          heading: "Supprimer son compte",
          paragraphs: [
            "La suppression est définitive et se confirme avec votre mot de passe. Votre profil et vos données privées sont effacés ; aucune restauration n'est possible. Le journal de sécurité garde des traces qui ne permettent plus de vous identifier directement.",
          ],
          links: [{ href: "/account/delete", label: "Supprimer mon compte" }],
        },
      ],
    },
    report: {
      title: "Signaler un contenu",
      summary: "Signaler une fiche du catalogue : lien cassé, erreur, atteinte à un droit.",
      sections: [
        {
          heading: "Comment signaler",
          paragraphs: [
            "Sur la page d'une fiche publiée, utilisez « Signaler cette ressource » et choisissez un motif : atteinte au droit d'auteur ou à une licence, données personnelles, erreur dans la fiche, lien cassé, contenu inapproprié, fichier ou lien malveillant, ou autre motif.",
            "La modération examine chaque signalement. Votre identité n'est pas communiquée. Le nombre de signalements est limité par jour, pour éviter les abus.",
          ],
          links: [{ href: "/search", label: "Rechercher dans le catalogue" }],
        },
      ],
    },
  },
};
