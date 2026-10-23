import type { Locale } from "@/i18n/routing";
import { en } from "./en";
import { fr } from "./fr";
import { pt } from "./pt";
import type { HelpContent } from "./types";

export { HELP_TOPICS, isHelpTopic, type HelpTopicId } from "./types";

// Une entrée par langue de l'interface : le type exige qu'aucune ne manque.
const HELP: Record<Locale, HelpContent> = { fr, en, pt };

export function helpContent(locale: Locale): HelpContent {
  return HELP[locale];
}
