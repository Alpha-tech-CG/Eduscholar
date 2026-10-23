import { ai } from "./ai";
import { content } from "./content";
import { LEGAL_ENTITY, type LegalEntityKey } from "./entity";
import { minors } from "./minors";
import { privacy } from "./privacy";
import type { LegalDocument, LegalPageId } from "./types";

export { isLegalPage, LEGAL_PAGES, type LegalPageId } from "./types";

const DOCUMENTS: Record<LegalPageId, LegalDocument> = { privacy, content, ai, minors };

export function legalDocument(page: LegalPageId): LegalDocument {
  return DOCUMENTS[page];
}

/** Mention affichée à la place d'une information pas encore fournie. Le build de production refuse qu'il en reste. */
export const MISSING_VALUE = "[à compléter]";

export type LegalTextPart = { text: string; missing: boolean };

/**
 * Découpe un texte en morceaux, les `{{clé}}` remplacés par leur valeur de
 * `entity.ts`. Une clé inconnue ou vide donne la mention « à compléter ».
 */
export function fillLegalText(
  text: string,
  entity: Readonly<Record<string, string>> = LEGAL_ENTITY,
): LegalTextPart[] {
  const parts: LegalTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{\{(\w+)\}\}/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), missing: false });
    const value = (match[1] && Object.hasOwn(entity, match[1]) ? entity[match[1]] : "")?.trim() ?? "";
    parts.push(value ? { text: value, missing: false } : { text: MISSING_VALUE, missing: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), missing: false });
  return parts;
}

/** Clés citées par les documents, pour vérifier qu'elles existent toutes dans `entity.ts`. */
export function referencedEntityKeys(): string[] {
  const keys = new Set<string>();
  for (const document of Object.values(DOCUMENTS)) {
    const texts = document.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.kind === "paragraph" ? [block.text] : block.kind === "list" ? block.items : [block.caption, ...block.head, ...block.rows.flat()],
      ),
    ]);
    for (const text of texts) for (const match of text.matchAll(/\{\{(\w+)\}\}/g)) if (match[1]) keys.add(match[1]);
  }
  return [...keys].sort();
}

export type { LegalEntityKey };
