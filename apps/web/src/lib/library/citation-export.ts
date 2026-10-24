// Export de la bibliothèque : BibTeX, RIS, CSV et bibliographie APA.
//
// Module pur : il reprend les métadonnées des fiches telles qu'elles sont au
// catalogue, avec la note et les tags personnels de l'utilisateur. Rien n'est
// inventé ni complété. Chaque format a son échappement :
//   - BibTeX : les caractères spéciaux de LaTeX sont protégés, les accolades
//     échappées, de sorte qu'aucune valeur ne ferme le champ ni n'ouvre une
//     commande ;
//   - RIS : une valeur par ligne ; tout saut de ligne ou caractère de contrôle
//     d'une valeur devient une espace, pour qu'aucune ligne ne soit injectée ;
//   - CSV : chaque cellule est entre guillemets ; une cellule qui commence par
//     un caractère qu'un tableur prend pour une formule est préfixée d'une
//     apostrophe.

import {
  buildBibliography,
  referenceText,
  type BibliographyLocale,
  type BibliographySource,
} from "@/lib/projects/bibliography";

export const LIBRARY_EXPORT_FORMATS = ["bib", "ris", "csv", "apa"] as const;
export type LibraryExportFormat = (typeof LIBRARY_EXPORT_FORMATS)[number];

export function isLibraryExportFormat(value: unknown): value is LibraryExportFormat {
  return typeof value === "string" && (LIBRARY_EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Une fiche de la bibliothèque, telle qu'elle est exportée. */
export type LibraryEntry = {
  id: string;
  typeCode: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  institutionName: string | null;
  thesisDegree: string | null;
  languageCode: string | null;
  doi: string | null;
  officialUrl: string | null;
  note: string | null;
  tags: string[];
};

// Caractères de contrôle (sauf tabulation et fins de ligne, traitées à part),
// contrôles C1 et caractères de format invisibles ou de sens d'écriture.
const INVISIBLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\xAD\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/gu;

/** Une valeur sur une seule ligne, sans caractère invisible. */
export function singleLine(value: string): string {
  return value.replace(INVISIBLE, "").replace(/[\t\r\n\u{2028}\u{2029}]+/gu, " ").replace(/ {2,}/g, " ").trim();
}

// -----------------------------------------------------------------------------
// BibTeX
// -----------------------------------------------------------------------------

const BIBTEX_SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "%": "\\%",
  "&": "\\&",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
};

/**
 * Valeur d'un champ BibTeX, à placer entre accolades. Un seul passage : les
 * accolades produites par l'échappement ne sont pas réexaminées, et toutes
 * celles de la valeur d'origine sont échappées, donc équilibrées.
 */
export function escapeBibtex(value: string): string {
  return singleLine(value).replace(/[\\{}%&$#_^~]/g, (char) => BIBTEX_SPECIALS[char] ?? char);
}

/**
 * Valeur d'un champ verbatim (doi, url) : BibTeX et biblatex ne l'interprètent
 * pas, donc rien n'y est échappé à la manière de LaTeX ; seules les accolades
 * et la barre oblique inverse, qui fermeraient le champ, sont encodées.
 */
export function escapeBibtexVerbatim(value: string): string {
  return singleLine(value).replace(/[{}\\]/g, (char) =>
    char === "{" ? "%7B" : char === "}" ? "%7D" : "%5C",
  );
}

function bibtexType(entry: LibraryEntry): string {
  switch (entry.typeCode) {
    case "article":
      return "article";
    case "book":
      return "book";
    case "chapter":
      return "incollection";
    case "thesis":
      return entry.thesisDegree === "doctorate" || entry.thesisDegree === null ? "phdthesis" : "mastersthesis";
    case "memoir":
      return "mastersthesis";
    case "report":
      return "techreport";
    default:
      return "misc";
  }
}

/** Partie ASCII d'un mot, pour la clé de citation. */
function asciiWord(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]/g, "");
}

/** Clé de citation : premier nom d'auteur et année, rendue unique par une lettre. */
function citationKeys(entries: LibraryEntry[]): string[] {
  const used = new Map<string, number>();
  return entries.map((entry) => {
    const first = entry.authors[0] ?? entry.title;
    const family = first.includes(",") ? first.slice(0, first.indexOf(",")) : (first.split(/\s+/)[0] ?? "");
    const base = `${asciiWord(family).slice(0, 30) || "ref"}${entry.publicationYear ?? ""}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}${suffix(seen)}`;
  });
}

function suffix(index: number): string {
  // 1 → a, 26 → z, 27 → aa…
  let n = index;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/**
 * Auteur BibTeX. « Nom, Prénom » se transmet tel quel ; un nom sans virgule
 * (un organisme, ou un nom saisi d'un bloc) est protégé par des accolades, pour
 * que BibTeX ne le découpe pas.
 */
function bibtexAuthor(name: string): string {
  const escaped = escapeBibtex(name);
  return name.includes(",") && !/\sand\s/i.test(name) ? escaped : `{${escaped}}`;
}

/** Institution : établissement d'une thèse ou d'un mémoire, organisme d'un rapport. */
function institutionOf(entry: LibraryEntry): string | null {
  return ["thesis", "memoir", "report"].includes(entry.typeCode) ? entry.institutionName : null;
}

function httpUrl(value: string | null): string | null {
  return value && /^https?:\/\/[^\s<>"]+$/i.test(value) ? value : null;
}

export function toBibtex(entries: LibraryEntry[]): string {
  const keys = citationKeys(entries);
  return entries
    .map((entry, index) => {
      const fields: [string, string][] = [];
      if (entry.authors.length > 0) {
        fields.push(["author", entry.authors.map(bibtexAuthor).join(" and ")]);
      }
      fields.push(["title", escapeBibtex(entry.title)]);
      if (entry.publicationYear !== null) fields.push(["year", String(entry.publicationYear)]);
      const institution = institutionOf(entry);
      if (institution) {
        fields.push([entry.typeCode === "report" ? "institution" : "school", escapeBibtex(institution)]);
      }
      if (entry.doi) fields.push(["doi", escapeBibtexVerbatim(entry.doi)]);
      const url = httpUrl(entry.officialUrl);
      if (url) fields.push(["url", escapeBibtexVerbatim(url)]);
      if (entry.languageCode) fields.push(["language", escapeBibtex(entry.languageCode)]);
      if (entry.tags.length > 0) fields.push(["keywords", entry.tags.map(escapeBibtex).join(", ")]);
      if (entry.note) fields.push(["annote", escapeBibtex(entry.note)]);
      const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n");
      return `@${bibtexType(entry)}{${keys[index]},\n${body}\n}\n`;
    })
    .join("\n");
}

// -----------------------------------------------------------------------------
// RIS
// -----------------------------------------------------------------------------

function risType(entry: LibraryEntry): string {
  switch (entry.typeCode) {
    case "article":
      return "JOUR";
    case "book":
      return "BOOK";
    case "chapter":
      return "CHAP";
    case "thesis":
    case "memoir":
      return "THES";
    case "report":
      return "RPRT";
    case "video":
      return "VIDEO";
    case "dataset":
      return "DATA";
    default:
      return "GEN";
  }
}

/** Ligne RIS : étiquette, deux espaces, tiret, espace, valeur sur une ligne. */
function risLine(tag: string, value: string): string | null {
  const clean = singleLine(value);
  return clean ? `${tag}  - ${clean}` : null;
}

export function toRis(entries: LibraryEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const entryLines = [
      `TY  - ${risType(entry)}`,
      ...entry.authors.map((author) => risLine("AU", author)),
      risLine("TI", entry.title),
      entry.publicationYear !== null ? risLine("PY", String(entry.publicationYear)) : null,
      institutionOf(entry) ? risLine("PB", institutionOf(entry) ?? "") : null,
      entry.doi ? risLine("DO", entry.doi) : null,
      httpUrl(entry.officialUrl) ? risLine("UR", entry.officialUrl ?? "") : null,
      entry.languageCode ? risLine("LA", entry.languageCode) : null,
      ...entry.tags.map((tag) => risLine("KW", tag)),
      entry.note ? risLine("N1", entry.note) : null,
      "ER  - ",
    ];
    lines.push(...entryLines.filter((line): line is string => line !== null), "");
  }
  // Le format attend des fins de ligne CR LF.
  return lines.join("\r\n");
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

/**
 * Cellule CSV : entre guillemets, guillemets doublés. La cellule est préfixée
 * d'une apostrophe dès qu'un caractère de formule (= + - @, ou leurs formes
 * pleine chasse) ouvre la valeur ou l'un de ses segments — après une
 * tabulation, un retour chariot, un saut de ligne, une virgule ou un
 * point-virgule, espaces comprises — ou que la valeur commence par une
 * tabulation ou un retour chariot. Un tableur qui redécoupe la cellule à
 * l'import n'y trouve ainsi aucune formule en tête de champ.
 */
const FORMULA = /(^|[\t\r\n,;])\s*[=+\-@\u{FF1D}\u{FF0B}\u{FF0D}\u{FF20}]/u;

export function csvCell(value: string): string {
  let text = value.replace(INVISIBLE, "");
  if (FORMULA.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS = [
  "title",
  "authors",
  "year",
  "type",
  "institution",
  "doi",
  "url",
  "language",
  "tags",
  "note",
  "eduscholar_id",
] as const;

export function toCsv(entries: LibraryEntry[]): string {
  const rows = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const entry of entries) {
    rows.push(
      [
        entry.title,
        entry.authors.join("; "),
        entry.publicationYear === null ? "" : String(entry.publicationYear),
        entry.typeCode,
        entry.institutionName ?? "",
        entry.doi ?? "",
        httpUrl(entry.officialUrl) ?? "",
        entry.languageCode ?? "",
        entry.tags.join("; "),
        entry.note ?? "",
        entry.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // Marque d'ordre des octets : un tableur reconnaît alors l'UTF-8.
  return `\u{FEFF}${rows.join("\r\n")}\r\n`;
}

// -----------------------------------------------------------------------------
// Bibliographie APA (formateur des projets)
// -----------------------------------------------------------------------------

/** Type de source d'un projet pour un type de fiche : la même table que la base. */
export function sourceTypeOf(typeCode: string): string {
  switch (typeCode) {
    case "article":
    case "book":
    case "chapter":
    case "thesis":
    case "report":
      return typeCode;
    case "memoir":
      return "thesis";
    default:
      return "other";
  }
}

export function toBibliographySource(entry: LibraryEntry): BibliographySource {
  return {
    id: entry.id,
    sourceType: sourceTypeOf(entry.typeCode),
    title: entry.title,
    authors: entry.authors,
    publicationYear: entry.publicationYear,
    containerTitle: null,
    publisher: institutionOf(entry),
    volume: null,
    issue: null,
    pages: null,
    doi: entry.doi,
    url: httpUrl(entry.officialUrl),
    accessedOn: null,
  };
}

/** Bibliographie en texte brut, une référence par paragraphe. */
export function toApaText(entries: LibraryEntry[], locale: BibliographyLocale): string {
  const { references } = buildBibliography(entries.map(toBibliographySource), locale);
  return `${references.map((reference) => singleLine(referenceText(reference))).join("\r\n\r\n")}\r\n`;
}

export const LIBRARY_EXPORT_MIME: Record<LibraryExportFormat, string> = {
  bib: "application/x-bibtex; charset=utf-8",
  ris: "application/x-research-info-systems; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  apa: "text/plain; charset=utf-8",
};

const EXTENSIONS: Record<LibraryExportFormat, string> = { bib: "bib", ris: "ris", csv: "csv", apa: "txt" };

/**
 * Nom du fichier : uniquement des lettres ASCII, chiffres et tirets ; rien de
 * l'utilisateur n'entre tel quel dans l'en-tête.
 */
export function libraryExportFileName(base: string, format: LibraryExportFormat): string {
  const slug = base
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${slug || "bibliotheque"}.${EXTENSIONS[format]}`;
}

export function renderLibraryExport(
  entries: LibraryEntry[],
  format: LibraryExportFormat,
  locale: BibliographyLocale,
): string {
  switch (format) {
    case "bib":
      return toBibtex(entries);
    case "ris":
      return toRis(entries);
    case "csv":
      return toCsv(entries);
    case "apa":
      return toApaText(entries, locale);
  }
}
