// Informations juridiques que le porteur de projet doit fournir avant
// l'ouverture en production. Une valeur vide s'affiche « [à compléter] » dans
// les pages juridiques ; le build de production Vercel échoue tant qu'il en
// reste une (voir `check.ts`, appelé par `next.config.ts`).
//
// Une valeur est un texte court, rendu tel quel, sans balise : une adresse
// électronique, un nom, une durée (« 12 mois »).

export const LEGAL_ENTITY = {
  /** Nom de l'entité juridique responsable du traitement (raison sociale ou nom de l'association). */
  controllerName: "",
  /** Adresse postale du siège de cette entité. */
  controllerAddress: "",
  /** Adresse électronique de contact pour la protection des données (exercice des droits). */
  dataProtectionContact: "",
  /** Autorité de contrôle compétente, selon le pays d'établissement et les pays pilotes. */
  supervisoryAuthority: "",
  /** Délai de réponse à une demande d'exercice des droits, selon la loi applicable (par exemple « un mois »). */
  rightsResponseDelay: "",
  /** Délai d'information après une violation de données, selon la loi applicable (par exemple « 72 heures »). */
  breachNotificationDelay: "",
  /** Durée avant l'avertissement d'un compte inactif, puis délai de suppression (le brouillon proposait « 24 mois, puis suppression 3 mois plus tard »). */
  inactiveAccountRetention: "",
  /** Durée de conservation du journal de sécurité (le brouillon proposait « 12 mois »). */
  securityLogRetention: "",
  /** Durée de conservation des sauvegardes après une suppression (le brouillon proposait « 30 à 90 jours »). */
  backupRetention: "",
  /** Durée de conservation des décisions de modération et des demandes de retrait (le brouillon proposait « 5 ans »). */
  moderationRecordRetention: "",
  /** Prestataire d'envoi des courriels (nom de la société). */
  mailProvider: "",
  /** Lieu de traitement de ce prestataire (pays ou région). */
  mailProviderLocation: "",
  /** Adresse électronique qui reçoit les demandes de retrait, y compris de personnes sans compte. */
  takedownContact: "",
  /** Délai de contestation d'une décision de retrait (le brouillon proposait « 14 jours »). */
  contestationPeriod: "",
  /** Personne ou fonction désignée pour recevoir les demandes des autorités judiciaires ou administratives. */
  authorityRequestsOfficer: "",
  /** Délai de suppression des données d'un compte qui se révèle être celui d'un mineur. */
  minorAccountDeletionDelay: "",
} as const satisfies Record<string, string>;

export type LegalEntityKey = keyof typeof LEGAL_ENTITY;
