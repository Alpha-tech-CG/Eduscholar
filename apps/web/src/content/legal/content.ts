import type { LegalDocument } from "./types";

// Repris de docs/product/content-and-licensing-policy.md et de
// docs/product/takedown-policy.md, sans l'en-tête de travail ni les notes
// destinées au juriste. La page réunit les deux : le contenu et les licences,
// puis la procédure de signalement et de retrait.

export const content: LegalDocument = {
  title: "Contenu, licences et retrait",
  updated: "2026-10-23",
  sections: [
    {
      heading: "1. Principes",
      blocks: [
        {
          kind: "list",
          ordered: true,
          items: [
            "Aucune ressource sans provenance. Chaque fiche indique d'où vient le document.",
            "Gratuit ne veut pas dire libre. Le statut d'accès et la licence sont deux informations distinctes, toutes deux affichées.",
            "En cas de doute, un lien. Sans licence claire ou sans autorisation, la plateforme renvoie vers la source officielle et n'héberge rien.",
            "Rien n'est publié automatiquement. Toute ressource passe par une vérification.",
            "Un retrait est toujours possible, et rapide.",
          ],
        },
      ],
    },
    {
      heading: "2. Ce que la plateforme accepte",
      blocks: [
        {
          kind: "list",
          items: [
            "Cours, articles, livres, thèses et mémoires, vidéos, exercices à visée éducative ou scientifique.",
            "Références issues des sources autorisées par la plateforme.",
            "Ressources déposées par leur auteur ou par un établissement qui en détient les droits.",
            "Liens vers des ressources légalement accessibles.",
          ],
        },
      ],
    },
    {
      heading: "3. Ce que la plateforme refuse",
      blocks: [
        {
          kind: "list",
          items: [
            "Toute œuvre diffusée sans l'accord de l'ayant droit : manuels scannés, articles payants recopiés, sujets d'examen protégés.",
            "Tout contenu obtenu en contournant un paiement, une authentification ou une protection.",
            "Les travaux d'autrui présentés comme les siens.",
            "Les services de rédaction à la place de l'étudiant, les mémoires « prêts à rendre ».",
            "Les contenus illicites, haineux, à caractère sexuel, ou sans rapport avec l'objet éducatif.",
            "Les données personnelles de tiers : listes d'étudiants, copies nominatives, bulletins.",
            "Les fichiers exécutables et tout fichier malveillant.",
            "Les sources, auteurs, DOI ou citations inventés.",
          ],
        },
      ],
    },
    {
      heading: "4. Deux modes de présence d'une ressource",
      blocks: [
        {
          kind: "table",
          caption: "Référencement et hébergement d'une ressource",
          head: ["Mode", "Quand", "Ce que fait la plateforme"],
          rows: [
            ["Référencement", "Toujours possible si le lien est légal", "Affiche les métadonnées et renvoie vers la source officielle"],
            ["Hébergement", "Seulement si la licence ou une autorisation écrite le permet", "Conserve le fichier et le propose en téléchargement"],
          ],
        },
        {
          kind: "paragraph",
          text: "Chaque licence indique si l'hébergement est possible. Les licences non commerciales restent en référencement seul tant que le modèle économique n'est pas arrêté.",
        },
      ],
    },
    {
      heading: "5. Informations obligatoires pour publier",
      blocks: [
        { kind: "paragraph", text: "Une ressource ne peut pas être publiée sans :" },
        {
          kind: "list",
          items: [
            "un titre et au moins un auteur ou une institution ;",
            "la source : connecteur, établissement ou contributeur ;",
            "le lien officiel, ou le fichier accompagné de son autorisation ;",
            "le statut d'accès ;",
            "la licence, ou la mention explicite « inconnue » (référencement seul) ;",
            "la date de dernière vérification.",
          ],
        },
        { kind: "paragraph", text: "Cette règle est imposée par la base de données, pas seulement par le formulaire." },
      ],
    },
    {
      heading: "6. Engagement du contributeur",
      blocks: [
        { kind: "paragraph", text: "En soumettant une ressource, le contributeur déclare :" },
        {
          kind: "list",
          ordered: true,
          items: [
            "en être l'auteur, ou détenir l'autorisation de l'ayant droit pour cette diffusion ;",
            "que les co-auteurs et, s'il y a lieu, l'établissement ont donné leur accord ;",
            "choisir la licence sous laquelle la ressource sera diffusée, en ayant lu ce qu'elle permet ;",
            "que le document ne contient pas de données personnelles de tiers sans leur accord ;",
            "accepter que la ressource soit vérifiée, refusée ou retirée.",
          ],
        },
        {
          kind: "paragraph",
          text: "La déclaration est enregistrée avec la date et le compte. Pour un mémoire ou une thèse, le règlement de l'établissement peut imposer un accord préalable : il revient au contributeur de le vérifier.",
        },
      ],
    },
    {
      heading: "7. Publication d'un mémoire par son auteur",
      blocks: [
        {
          kind: "list",
          items: [
            "Un projet de recherche est privé et le reste.",
            "La publication est un acte séparé, volontaire et explicite de l'auteur.",
            "L'auteur choisit la licence et peut demander le retrait.",
            "Avant publication, la plateforme rappelle de vérifier le règlement de l'établissement, l'accord de l'encadreur si nécessaire, et l'absence de données confidentielles ou personnelles (entretiens, enquêtes).",
            "Les métadonnées cachées du fichier (auteur, suivi des modifications) sont nettoyées.",
          ],
        },
      ],
    },
    {
      heading: "8. Vérification et modération",
      blocks: [
        {
          kind: "paragraph",
          text: "Une ressource soumise passe par un contrôle automatique puis par la modération, avant d'être vérifiée et publiée ; elle peut aussi être rejetée, ou faire l'objet d'une demande de correction.",
        },
        {
          kind: "list",
          items: [
            "Contrôle automatique : champs obligatoires, format du lien, type réel et taille du fichier, analyse antivirus, recherche de doublons.",
            "Modération humaine : cohérence de la licence avec la source, provenance, pertinence éducative.",
            "Un modérateur ne traite pas sa propre soumission.",
            "Un établissement vérifié publie son propre catalogue sous sa responsabilité ; un modérateur peut suspendre.",
            "Modifier la source, la licence, le lien, le fichier ou la visibilité d'une ressource publiée entraîne une nouvelle vérification.",
            "Chaque décision est conservée, avec son motif.",
          ],
        },
      ],
    },
    {
      heading: "9. Score de qualité",
      blocks: [
        {
          kind: "paragraph",
          text: "Le score est un indicateur d'aide, calculé à partir de critères visibles : provenance, complétude, licence, fraîcheur, fiabilité de l'institution, pertinence, moins les doublons, liens cassés et signalements non résolus. Il est explicable critère par critère et ne constitue pas une validation scientifique.",
        },
      ],
    },
    {
      heading: "10. Attribution",
      blocks: [
        {
          kind: "paragraph",
          text: "Chaque fiche affiche l'auteur, le titre, la source, la licence et le lien d'origine. Une ressource issue d'un connecteur mentionne la base d'où viennent ses métadonnées.",
        },
      ],
    },
    {
      heading: "11. Sanctions",
      blocks: [
        {
          kind: "paragraph",
          text: "Avertissement, retrait de la ressource, suspension de la possibilité de contribuer, suspension du compte en cas de récidive ou de fraude manifeste. Chaque mesure est motivée et peut être contestée.",
        },
      ],
    },
    {
      heading: "12. Signalement et demande de retrait",
      blocks: [
        {
          kind: "paragraph",
          text: "Toute personne — auteur, éditeur, établissement, utilisateur — peut demander le retrait ou la correction d'une ressource du catalogue. La demande reçoit une réponse rapide, traçable et contestable. Cette procédure concerne le catalogue public. Les projets privés ne sont pas publiés et ne sont pas visés, sauf obligation légale.",
        },
        {
          kind: "table",
          caption: "Les deux voies pour signaler une ressource",
          head: ["Voie", "Pour qui", "Accès"],
          rows: [
            ["Signalement", "Utilisateur connecté", "Bouton sur chaque fiche"],
            ["Demande de retrait", "Toute personne, y compris sans compte : ayant droit, éditeur, établissement", "Par écrit à l'adresse {{takedownContact}}"],
          ],
        },
        { kind: "paragraph", text: "Motifs :" },
        {
          kind: "list",
          items: [
            "Atteinte au droit d'auteur ou à une licence.",
            "Données personnelles ou atteinte à la vie privée.",
            "Demande de l'auteur lui-même.",
            "Contenu illicite ou inapproprié.",
            "Erreur de métadonnées : auteur, licence, date.",
            "Lien cassé ou source disparue.",
            "Fichier malveillant.",
          ],
        },
      ],
    },
    {
      heading: "13. Contenu d'une demande de retrait",
      blocks: [
        {
          kind: "list",
          ordered: true,
          items: [
            "Identité et qualité du demandeur : auteur, ayant droit, représentant.",
            "Coordonnées de contact.",
            "Adresse de la ressource visée sur la plateforme.",
            "Œuvre ou droit concerné, et en quoi la ressource y porte atteinte.",
            "Déclaration sur l'honneur de l'exactitude de la demande.",
          ],
        },
        { kind: "paragraph", text: "Une demande incomplète reçoit une demande de précision ; elle n'est pas ignorée." },
      ],
    },
    {
      heading: "14. Traitement d'une demande",
      blocks: [
        {
          kind: "paragraph",
          text: "Une demande est reçue, fait l'objet d'un accusé de réception, puis d'un examen et d'une décision notifiée, qui peut être contestée.",
        },
        {
          kind: "table",
          caption: "Délais visés pour chaque étape",
          head: ["Étape", "Délai visé"],
          rows: [
            ["Accusé de réception", "24 heures"],
            ["Suspension conservatoire si la demande paraît fondée", "48 heures"],
            ["Fichier malveillant ou contenu manifestement illicite", "Suspension immédiate"],
            ["Décision motivée", "7 jours"],
            ["Correction de métadonnées ou de lien", "7 jours"],
          ],
        },
        { kind: "paragraph", text: "Ces délais sont des objectifs de service." },
        {
          kind: "paragraph",
          text: "Suspension conservatoire. En cas de doute sérieux, la ressource est suspendue pendant l'examen : elle disparaît aussitôt de la recherche et de sa page publique. Le doute profite au retrait.",
        },
      ],
    },
    {
      heading: "15. Décisions possibles",
      blocks: [
        {
          kind: "table",
          caption: "Décisions possibles et leurs effets",
          head: ["Décision", "Effet"],
          rows: [
            ["Retrait", "La ressource est retirée ; le fichier hébergé est rendu inaccessible puis supprimé à l'issue du délai de contestation"],
            ["Passage en référencement seul", "Le fichier n'est plus hébergé ; la fiche renvoie vers la source officielle"],
            ["Correction", "Métadonnées, licence ou lien corrigés ; nouvelle vérification"],
            ["Maintien", "Demande rejetée, avec motif"],
          ],
        },
        {
          kind: "paragraph",
          text: "La ressource retirée n'est pas effacée de l'historique : la décision, son motif et sa date sont conservés comme preuve. Elle n'apparaît plus ni dans la recherche ni dans les collections des utilisateurs, qui voient la mention « ressource retirée ».",
        },
      ],
    },
    {
      heading: "16. Information des personnes",
      blocks: [
        {
          kind: "list",
          items: [
            "Le demandeur reçoit la décision et son motif.",
            "Le contributeur est informé de la demande et de la décision, sans les coordonnées personnelles du demandeur lorsque celui-ci est un particulier.",
            "L'identité d'un utilisateur qui signale n'est communiquée ni au contributeur ni à l'établissement visé.",
          ],
        },
      ],
    },
    {
      heading: "17. Contestation",
      blocks: [
        {
          kind: "paragraph",
          text: "Le contributeur ou le demandeur peut contester une décision dans un délai de {{contestationPeriod}}, en apportant des éléments : preuve de licence, autorisation écrite. La contestation est examinée par une autre personne que celle qui a pris la décision initiale, lorsque l'effectif le permet.",
        },
      ],
    },
    {
      heading: "18. Abus",
      blocks: [
        {
          kind: "paragraph",
          text: "Les demandes manifestement infondées ou répétées peuvent être écartées. Les signalements abusifs répétés entraînent la suspension du droit de signaler.",
        },
      ],
    },
    {
      heading: "19. Demandes d'autorités",
      blocks: [
        {
          kind: "paragraph",
          text: "Une demande d'une autorité judiciaire ou administrative est transmise au responsable désigné ({{authorityRequestsOfficer}}), vérifiée, traitée dans le strict périmètre demandé et consignée.",
        },
      ],
    },
    {
      heading: "20. Traçabilité et décision",
      blocks: [
        {
          kind: "paragraph",
          text: "Chaque demande, décision et contestation est enregistrée dans le journal d'audit. Sont suivis : le nombre de demandes, le délai de traitement, la part de retraits et de contestations.",
        },
        {
          kind: "paragraph",
          text: "Les modérateurs traitent les signalements et les demandes de retrait. Un établissement peut retirer ses propres ressources. Un administrateur n'intervient que s'il détient aussi le rôle de modérateur.",
        },
      ],
    },
  ],
};
