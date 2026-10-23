// Aide en ligne (F-05) : le contenu vit dans un fichier par langue de
// l'interface, à côté des catalogues de messages. Le type impose à chaque
// langue les mêmes sujets ; les tests vérifient qu'aucun texte ne manque et
// que chaque lien mène à une page de l'application.

/** Sujets de l'aide, dans l'ordre de l'index. L'identifiant sert d'adresse : `/help/<sujet>`. */
export const HELP_TOPICS = [
  "account",
  "search",
  "library",
  "project",
  "sharing",
  "offline",
  "data",
  "report",
] as const;
export type HelpTopicId = (typeof HELP_TOPICS)[number];

/** Un lien vers une page de l'application, sans préfixe de langue (`/search`, `/help/data`). */
export type HelpLink = { href: string; label: string };

export type HelpSection = {
  heading: string;
  /** Paragraphes de texte simple, rendus tels quels. */
  paragraphs: string[];
  links?: HelpLink[];
};

export type HelpTopic = {
  title: string;
  /** Une phrase, reprise dans l'index et comme description de la page. */
  summary: string;
  sections: HelpSection[];
};

export type HelpContent = {
  index: {
    title: string;
    intro: string;
    topicsHeading: string;
    /** Ce que l'aide ne remplace pas : le dire plutôt que promettre. */
    note: string;
  };
  backToIndex: string;
  relatedHeading: string;
  topics: Record<HelpTopicId, HelpTopic>;
};

export function isHelpTopic(value: unknown): value is HelpTopicId {
  return typeof value === "string" && (HELP_TOPICS as readonly string[]).includes(value);
}
