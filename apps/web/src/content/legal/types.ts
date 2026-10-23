// Pages juridiques provisoires. Le texte de fond n'existe qu'en français, la
// langue des brouillons (`docs/product/`) ; il est affiché tel quel, marqué
// `lang="fr"`, quelle que soit la langue de l'interface.
//
// Une information à fournir par le porteur de projet s'écrit `{{clé}}` dans le
// texte : elle est lue dans `entity.ts` à l'affichage, jamais écrite ici.

export const LEGAL_PAGES = ["privacy", "content", "ai", "minors"] as const;
export type LegalPageId = (typeof LEGAL_PAGES)[number];

export type LegalBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; caption: string; head: string[]; rows: string[][] };

export type LegalSection = { heading: string; blocks: LegalBlock[] };

export type LegalDocument = {
  /** Titre du document, en français. */
  title: string;
  /** Date de la version publiée, AAAA-MM-JJ. */
  updated: string;
  sections: LegalSection[];
};

export function isLegalPage(value: unknown): value is LegalPageId {
  return typeof value === "string" && (LEGAL_PAGES as readonly string[]).includes(value);
}
