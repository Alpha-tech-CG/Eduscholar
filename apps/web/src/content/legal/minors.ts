import type { LegalDocument } from "./types";

// Repris de docs/product/minors-policy.md, sans l'en-tête de travail, sans la
// note de décision destinée au porteur de projet (options A, B, C) ni les
// mesures de l'option B, qui ne s'appliquent pas : c'est l'option A, « majeurs
// uniquement », qui est en vigueur tant que la décision n'est pas prise.

export const minors: LegalDocument = {
  title: "Protection des mineurs",
  updated: "2026-10-23",
  sections: [
    {
      heading: "1. La règle en vigueur",
      blocks: [
        {
          kind: "paragraph",
          text: "L'inscription est réservée aux personnes qui ont l'âge de la majorité selon la loi de leur pays. L'âge de la majorité comme celui du consentement numérique varient selon les pays.",
        },
      ],
    },
    {
      heading: "2. Mesures appliquées",
      blocks: [
        {
          kind: "list",
          items: [
            "À l'inscription : déclaration d'avoir l'âge requis dans son pays. Seule la confirmation est conservée, pas la date de naissance.",
            "Niveau « Lycée » absent du profil.",
            "Si un compte se révèle être celui d'un mineur : suspension, information de la personne, suppression des données dans un délai de {{minorAccountDeletionDelay}}.",
          ],
        },
        { kind: "paragraph", text: "Limite connue : une déclaration d'âge n'est pas une vérification." },
      ],
    },
    {
      heading: "3. Espaces communautaires",
      blocks: [
        {
          kind: "paragraph",
          text: "La plateforme ne comporte ni forum, ni messagerie, ni profils publics consultables. Les seuls échanges sont les commentaires entre un étudiant et la personne qu'il a invitée sur son projet. Toute fonction communautaire future exige une révision de cette page.",
        },
      ],
    },
    {
      heading: "4. Étudiants vulnérables",
      blocks: [
        { kind: "paragraph", text: "Indépendamment de l'âge :" },
        {
          kind: "list",
          items: [
            "signalement d'un comportement abusif d'un membre invité, y compris un encadreur ;",
            "retrait d'un membre par le propriétaire du projet, à effet immédiat ;",
            "aucune information de profil exposée par défaut ;",
            "aucun contact possible par un inconnu.",
          ],
        },
      ],
    },
  ],
};
