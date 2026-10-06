import {
  buildBibliography,
  formatAuthor,
  type BibliographyLocale,
  type BibliographySource,
  type Segment,
} from "./bibliography";
import { numberSections } from "./section-schemas";

// Document d'un projet : le mémoire tel qu'il s'exporte. Module pur, commun à
// la page imprimable, au fichier DOCX et au fichier Markdown : les trois
// sorties disent la même chose.
//
// Le document ne contient que ce que l'étudiant a écrit ou saisi : son texte,
// ses titres, ses sources. Rien n'est ajouté, résumé ni reformulé.

export type DocumentInput = {
  title: string;
  supervisorName: string | null;
  sections: Array<{ id: string; level: number; title: string; body: string | null }>;
  /** Sources citées par section : identifiant de section → citations. */
  citations: Map<string, Array<{ sourceId: string; pages: string | null }>>;
  sources: Array<BibliographySource>;
};

export type DocumentSection = {
  id: string;
  level: 1 | 2 | 3;
  number: string;
  title: string;
  /** Paragraphes ; chacun est une suite de lignes. */
  paragraphs: string[][];
  /** Sources citées, dans l'ordre alphabétique : « Diop, A. (2021), p. 12 ». */
  citations: string[];
};

export type ProjectDocument = {
  locale: BibliographyLocale;
  title: string;
  supervisorName: string | null;
  sections: DocumentSection[];
  references: Segment[][];
  labels: {
    supervisor: string;
    contents: string;
    cited: string;
    references: string;
  };
};

const LABELS = {
  fr: {
    supervisor: "Sous la direction de",
    contents: "Table des matières",
    cited: "Sources citées dans cette section :",
    references: "Références",
    noDate: "s. d.",
  },
  en: {
    supervisor: "Supervised by",
    contents: "Table of contents",
    cited: "Sources cited in this section:",
    references: "References",
    noDate: "n.d.",
  },
} as const;

/** Découpe un texte en paragraphes (séparés par une ligne vide) et en lignes. */
export function splitParagraphs(body: string | null): string[][] {
  if (!body) return [];
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0);
}

function citationLabel(
  source: BibliographySource,
  pages: string | null,
  locale: BibliographyLocale,
): string {
  // Le premier auteur tel qu'il figure en bibliographie, ou le titre à défaut.
  const first = source.authors[0] ? formatAuthor(source.authors[0]).text : source.title;
  const others = source.authors.length > 1 ? " et al." : "";
  const year = source.publicationYear ?? LABELS[locale].noDate;
  return `${first}${others} (${year})${pages ? `, ${pages}` : ""}`;
}

export function buildDocument(input: DocumentInput, locale: BibliographyLocale): ProjectDocument {
  const labels = LABELS[locale];
  const byId = new Map(input.sources.map((source) => [source.id, source]));
  const numbers = numberSections(input.sections.map((section) => section.level));
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });

  const sections = input.sections.map((section, index): DocumentSection => {
    const level = Math.min(3, Math.max(1, Math.trunc(section.level) || 1)) as 1 | 2 | 3;
    const citations = (input.citations.get(section.id) ?? [])
      // Une citation dont la source n'existe plus dans le projet est ignorée.
      .flatMap(({ sourceId, pages }) => {
        const source = byId.get(sourceId);
        return source ? [citationLabel(source, pages, locale)] : [];
      })
      .sort(collator.compare);

    return {
      id: section.id,
      level,
      number: numbers[index] ?? "",
      title: section.title,
      paragraphs: splitParagraphs(section.body),
      citations,
    };
  });

  return {
    locale,
    title: input.title,
    supervisorName: input.supervisorName,
    sections,
    references: buildBibliography(input.sources, locale).references.map(
      (reference) => reference.segments,
    ),
    labels: {
      supervisor: labels.supervisor,
      contents: labels.contents,
      cited: labels.cited,
      references: labels.references,
    },
  };
}

/** Nombre de lignes de texte au-delà duquel un document n'est pas produit. */
export const DOCUMENT_MAX_LINES = 30000;

/** Nombre de lignes de texte d'un document. */
export function countLines(document: ProjectDocument): number {
  return document.sections.reduce(
    (total, section) => total + section.paragraphs.reduce((sum, lines) => sum + lines.length, 0),
    0,
  );
}

/**
 * Nom de fichier sûr, tiré du titre : lettres non accentuées, chiffres et
 * tirets. Le préfixe fixe écarte les noms réservés de certains systèmes.
 */
export function exportFileName(title: string, extension: string): string {
  const base = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `memoire${base ? `-${base}` : ""}.${extension}`;
}

// -----------------------------------------------------------------------------
// Markdown
// -----------------------------------------------------------------------------

/** Neutralise les caractères qui, en Markdown, changeraient la mise en forme. */
function escapeMarkdown(text: string): string {
  // « & » aussi : « &copy; » saisi doit rester « &copy; ».
  return text.replace(/([\\`*_{}[\]<>#|~&])/g, "\\$1");
}

/**
 * Une ligne qui commencerait un bloc est neutralisée : liste (« - », « + »,
 * « 1. »), filet ou soulignement de titre (« --- », « === »).
 */
function escapeLine(line: string): string {
  return escapeMarkdown(line)
    .replace(/^(\s*)([-+=]+)(\s|$)/, (_match, lead: string, marks: string, rest: string) =>
      `${lead}${marks.replace(/[-+=]/g, "\\$&")}${rest}`,
    )
    .replace(/^(\s*)(\d+)([.)])(\s|$)/, "$1$2\\$3$4");
}

/**
 * Texte d'une référence : les adresses y figurent telles quelles, entre
 * chevrons, pour rester exactes ; le reste est neutralisé.
 */
function escapeReferenceText(text: string): string {
  return text
    .split(/(https?:\/\/[^\s<>]+)/)
    .map((part, index) => (index % 2 === 1 ? `<${part}>` : escapeMarkdown(part)))
    .join("");
}

export function toMarkdown(document: ProjectDocument): string {
  const out: string[] = [`# ${escapeMarkdown(document.title)}`, ""];
  if (document.supervisorName) {
    out.push(`${document.labels.supervisor} ${escapeMarkdown(document.supervisorName)}`, "");
  }

  for (const section of document.sections) {
    out.push(`${"#".repeat(section.level + 1)} ${section.number} ${escapeMarkdown(section.title)}`, "");
    for (const lines of section.paragraphs) {
      // Deux espaces en fin de ligne : saut de ligne à l'intérieur du paragraphe.
      out.push(lines.map(escapeLine).join("  \n"), "");
    }
    if (section.citations.length > 0) {
      out.push(`${document.labels.cited} ${section.citations.map(escapeMarkdown).join(" ; ")}`, "");
    }
  }

  if (document.references.length > 0) {
    out.push(`## ${document.labels.references}`, "");
    for (const segments of document.references) {
      out.push(
        segments
          .map((segment, index) => {
            const escaped = segment.italic ? escapeMarkdown(segment.text) : escapeReferenceText(segment.text);
            // En tête de référence, un « 1. » ou un « - » n'ouvre pas de liste.
            const text =
              index === 0
                ? escaped
                    .replace(/^(\s*)([-+=]+)(\s|$)/, (_match, lead: string, marks: string, rest: string) =>
                      `${lead}${marks.replace(/[-+=]/g, "\\$&")}${rest}`,
                    )
                    .replace(/^(\s*)(\d+)([.)])(\s|$)/, "$1$2\\$3$4")
                : escaped;
            if (!segment.italic) return text;
            // L'italique ne doit pas commencer ni finir par un espace.
            const lead = /^\s*/.exec(text)?.[0] ?? "";
            const trail = /\s*$/.exec(text)?.[0] ?? "";
            const core = text.slice(lead.length, text.length - trail.length);
            return core ? `${lead}*${core}*${trail}` : text;
          })
          .join(""),
        "",
      );
    }
  }

  return `${out.join("\n").trimEnd()}\n`;
}
