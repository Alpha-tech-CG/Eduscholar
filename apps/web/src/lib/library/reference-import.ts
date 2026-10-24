// Import de références BibTeX et RIS vers les sources d'un projet.
//
// Module pur, exécuté côté serveur. Le fichier est lu comme du texte et
// analysé caractère par caractère, sans expression régulière à retour arrière
// sur l'entrée, sans évaluation : une commande LaTeX n'est jamais interprétée,
// seules quelques formes d'accents connues sont traduites, le reste est retiré.
//
// Bornes : 1 Mo, 500 entrées, 60 champs par entrée, 20 000 caractères par
// valeur brute, 32 niveaux d'accolades, 100 macros @string. Chaque entrée est
// ensuite validée par le schéma des sources (`sourceSchema`), que la base
// répète. Rien n'est inventé : un champ facultatif invalide est écarté (et
// signalé), une entrée sans titre est refusée.

import { sourceSchema, toSourcePayload, type SourceType } from "@/lib/projects/source-schemas";

export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ENTRIES = 500;
const MAX_FIELDS = 60;
const MAX_VALUE = 20_000;
const MAX_DEPTH = 32;
const MAX_MACROS = 100;
/** Longueur d'une macro @string. */
const MAX_MACRO = 2_000;
/**
 * Caractères de toutes les valeurs, après expansion des macros : au-delà, le
 * fichier est traité comme trop gros. Sans ce budget, cent macros reprises
 * dans chaque champ de chaque entrée démultiplieraient le texte à traiter.
 */
export const IMPORT_MAX_EXPANDED = 2 * 1_000_000;
const MAX_RIS_LINE = 20_000;

export type ImportFormat = "bibtex" | "ris";

export type RejectionCode =
  | "missing_title"
  | "invalid"
  | "too_many_fields"
  | "syntax"
  | "duplicate_in_file"
  | "too_many_entries";

/** Champs écartés d'une entrée acceptée, parce qu'ils étaient invalides. */
export type DroppedField =
  | "publicationYear"
  | "containerTitle"
  | "publisher"
  | "volume"
  | "issue"
  | "pages"
  | "doi"
  | "url"
  | "accessedOn";

export type ImportedReference = {
  sourceType: SourceType;
  title: string;
  authors: string[];
  publicationYear: string;
  containerTitle: string;
  publisher: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  url: string;
  accessedOn: string;
};

export type AcceptedEntry = {
  /** Rang de l'entrée dans le fichier, à partir de zéro. */
  index: number;
  reference: ImportedReference;
  dropped: DroppedField[];
  payload: ReturnType<typeof toSourcePayload>;
};

export type RejectedEntry = { index: number; label: string; code: RejectionCode };

export type ParseResult = {
  format: ImportFormat | null;
  accepted: AcceptedEntry[];
  rejected: RejectedEntry[];
  /** Le fichier dépasse la taille admise : rien n'est analysé. */
  tooLarge: boolean;
};

const EMPTY: ImportedReference = {
  sourceType: "other",
  title: "",
  authors: [],
  publicationYear: "",
  containerTitle: "",
  publisher: "",
  volume: "",
  issue: "",
  pages: "",
  doi: "",
  url: "",
  accessedOn: "",
};

/** Taille en octets UTF-8, sans allouer de tampon. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u{AD}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/gu;

/** Une ligne propre : sans caractère invisible, espaces réduites. */
function clean(value: string): string {
  return value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().normalize("NFC");
}

export function detectFormat(text: string): ImportFormat | null {
  // Lignes d'en-tête RIS : « TY  - ». On ne regarde que le début du fichier.
  const head = text.slice(0, 5000);
  if (/^\s*TY {2}- ?/m.test(head)) return "ris";
  if (/@[A-Za-z]+\s*[{(]/.test(head)) return "bibtex";
  return null;
}

// -----------------------------------------------------------------------------
// BibTeX
// -----------------------------------------------------------------------------

type RawEntry = { type: string; fields: Map<string, string>; tooManyFields: boolean; syntax: boolean };

const ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ć", n: "ń", s: "ś", z: "ź", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", Y: "Ý", C: "Ć", N: "Ń", S: "Ś", Z: "Ź" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
  c: { c: "ç", C: "Ç", s: "ş", S: "Ş" },
};

const SYMBOLS: Record<string, string> = {
  ss: "ß",
  o: "ø",
  O: "Ø",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  l: "ł",
  L: "Ł",
  i: "ı",
};

/**
 * Valeur LaTeX vers texte. Les accents usuels sont traduits ; les caractères
 * échappés (\& \% \_ \$ \# \{ \}) rendus ; toute autre commande est retirée,
 * son argument conservé ; les accolades disparaissent. Linéaire.
 */
export function latexToText(value: string): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const char = value[i] ?? "";
    if (char === "{" || char === "}") {
      i += 1;
      continue;
    }
    if (char !== "\\") {
      out += char;
      i += 1;
      continue;
    }
    const next = value[i + 1] ?? "";
    if ("&%_$#{}".includes(next) && next !== "") {
      out += next;
      i += 2;
      continue;
    }
    if (next === "\\") {
      out += " ";
      i += 2;
      continue;
    }
    const accents = ACCENTS[next];
    // \c n'est la cédille que suivi d'un argument : \c{c} ou \c c.
    if (accents && (next !== "c" || value[i + 2] === "{" || value[i + 2] === " ")) {
      // \'e, \'{e}, \c{c}, \c c
      let j = i + 2;
      while (value[j] === " ") j += 1;
      let letter = value[j] ?? "";
      let end = j + 1;
      if (letter === "{") {
        letter = value[j + 1] ?? "";
        end = value[j + 2] === "}" ? j + 3 : j + 2;
      }
      const mapped = accents[letter];
      if (mapped) {
        out += mapped;
        i = end;
        continue;
      }
    }
    // Commande nommée : \textit, \ss, \o…
    let j = i + 1;
    while (j < value.length && /[A-Za-z]/.test(value[j] ?? "")) j += 1;
    const name = value.slice(i + 1, j);
    if (name && Object.hasOwn(SYMBOLS, name)) {
      out += SYMBOLS[name];
    }
    // Autre caractère après la barre : retiré avec elle.
    i = name ? j : i + 2;
    // L'espace qui termine le nom d'une commande n'est pas du texte.
    if (name && value[i] === " ") i += 1;
  }
  return out.replace(/---/g, "—").replace(/--/g, "–");
}

class Scanner {
  i = 0;
  constructor(readonly text: string) {}

  get done() {
    return this.i >= this.text.length;
  }
  peek() {
    return this.text[this.i] ?? "";
  }
  skipSpace() {
    while (this.i < this.text.length && /\s/.test(this.text[this.i] ?? "")) this.i += 1;
  }
  identifier(): string {
    const start = this.i;
    while (this.i < this.text.length && /[A-Za-z0-9_\-:.+/]/.test(this.text[this.i] ?? "")) {
      this.i += 1;
      if (this.i - start > 100) break;
    }
    return this.text.slice(start, this.i);
  }

  /**
   * Contenu entre accolades, sans les accolades extérieures. `null` si le
   * groupe n'est pas fermé, trop profond ou trop long.
   */
  braced(): string | null {
    // this.peek() === "{"
    let depth = 0;
    const start = this.i + 1;
    while (this.i < this.text.length) {
      const char = this.text[this.i];
      if (char === "\\") {
        this.i += 2;
        continue;
      }
      if (char === "{") {
        depth += 1;
        if (depth > MAX_DEPTH) return null;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const value = this.text.slice(start, this.i);
          this.i += 1;
          return value.length > MAX_VALUE ? null : value;
        }
      }
      this.i += 1;
      if (this.i - start > MAX_VALUE + 1) return null;
    }
    return null;
  }

  quoted(): string | null {
    // this.peek() === '"'
    this.i += 1;
    const start = this.i;
    let depth = 0;
    while (this.i < this.text.length) {
      const char = this.text[this.i];
      if (char === "\\") {
        this.i += 2;
        continue;
      }
      if (char === "{") {
        depth += 1;
        if (depth > MAX_DEPTH) return null;
      } else if (char === "}") {
        depth -= 1;
        if (depth < 0) return null;
      } else if (char === '"' && depth === 0) {
        const value = this.text.slice(start, this.i);
        this.i += 1;
        return value.length > MAX_VALUE ? null : value;
      }
      this.i += 1;
      if (this.i - start > MAX_VALUE) return null;
    }
    return null;
  }

  /** Passe un bloc équilibré ouvert par `open` (pour @comment, @preamble). */
  skipBlock(open: string): boolean {
    const close = open === "(" ? ")" : "}";
    let depth = 0;
    while (this.i < this.text.length) {
      const char = this.text[this.i];
      if (char === "\\") {
        this.i += 2;
        continue;
      }
      if (char === open) depth += 1;
      else if (char === close) {
        depth -= 1;
        if (depth === 0) {
          this.i += 1;
          return true;
        }
      }
      this.i += 1;
    }
    return false;
  }
}

/** Valeur d'un champ : parties jointes par « # ». */
type Budget = { left: number };

function readValue(scanner: Scanner, macros: Map<string, string>, budget: Budget): string | null {
  let value = "";
  for (let parts = 0; parts < 50; parts += 1) {
    scanner.skipSpace();
    const char = scanner.peek();
    let part: string | null;
    if (char === "{") part = scanner.braced();
    else if (char === '"') part = scanner.quoted();
    else {
      const name = scanner.identifier();
      if (!name) return null;
      part = /^\d+$/.test(name) ? name : (macros.get(name.toLowerCase()) ?? MONTHS[name.toLowerCase()] ?? "");
    }
    if (part === null) return null;
    budget.left -= part.length;
    if (budget.left < 0) return null;
    value += part;
    if (value.length > MAX_VALUE) return null;
    scanner.skipSpace();
    if (scanner.peek() !== "#") return value;
    scanner.i += 1;
  }
  return null;
}

const MONTHS: Record<string, string> = {
  jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6",
  jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12",
};

/** Lit les entrées d'un fichier BibTeX. */
export function readBibtex(text: string): RawEntry[] {
  return scanBibtex(text).entries;
}

/** Entrées, et dépassement du budget de caractères après expansion des macros. */
export function scanBibtex(text: string): { entries: RawEntry[]; overBudget: boolean } {
  const scanner = new Scanner(text);
  const macros = new Map<string, string>();
  const entries: RawEntry[] = [];
  const budget: Budget = { left: IMPORT_MAX_EXPANDED };

  while (!scanner.done && entries.length <= IMPORT_MAX_ENTRIES) {
    if (budget.left < 0) return { entries, overBudget: true };
    const at = text.indexOf("@", scanner.i);
    if (at < 0) break;
    scanner.i = at + 1;
    scanner.skipSpace();
    const type = scanner.identifier().toLowerCase();
    scanner.skipSpace();
    const open = scanner.peek();
    if (!type || (open !== "{" && open !== "(")) continue;

    if (type === "comment" || type === "preamble") {
      if (!scanner.skipBlock(open)) break;
      continue;
    }
    const close = open === "(" ? ")" : "}";
    scanner.i += 1;

    if (type === "string") {
      scanner.skipSpace();
      const name = scanner.identifier().toLowerCase();
      scanner.skipSpace();
      if (name && scanner.peek() === "=") {
        scanner.i += 1;
        const value = readValue(scanner, macros, budget);
        if (value !== null && value.length <= MAX_MACRO && macros.size < MAX_MACROS) macros.set(name, value);
      }
      // Jusqu'à la fermeture de la définition.
      while (!scanner.done && scanner.peek() !== close && scanner.peek() !== "@") scanner.i += 1;
      if (scanner.peek() === close) scanner.i += 1;
      continue;
    }

    const entry: RawEntry = { type, fields: new Map(), tooManyFields: false, syntax: false };
    entries.push(entry);
    // Clé de citation : ignorée (une source a son propre identifiant).
    while (!scanner.done && scanner.peek() !== "," && scanner.peek() !== close) {
      if (scanner.peek() === "@" || scanner.i - at > 300) break;
      scanner.i += 1;
    }

    for (;;) {
      scanner.skipSpace();
      if (scanner.peek() === ",") {
        scanner.i += 1;
        scanner.skipSpace();
      }
      if (scanner.peek() === close) {
        scanner.i += 1;
        break;
      }
      if (scanner.done || scanner.peek() === "@") {
        entry.syntax = true;
        break;
      }
      const name = scanner.identifier().toLowerCase();
      scanner.skipSpace();
      if (!name || scanner.peek() !== "=") {
        entry.syntax = true;
        break;
      }
      scanner.i += 1;
      const value = readValue(scanner, macros, budget);
      if (value === null) {
        entry.syntax = true;
        break;
      }
      if (entry.fields.size >= MAX_FIELDS) {
        entry.tooManyFields = true;
      } else if (!entry.fields.has(name)) {
        entry.fields.set(name, value);
      }
    }
    if (entry.syntax) {
      // Reprise à l'entrée suivante.
      const nextAt = text.indexOf("@", scanner.i);
      scanner.i = nextAt < 0 ? text.length : nextAt;
    }
  }
  return { entries, overBudget: budget.left < 0 };
}

/** Sépare les auteurs sur « and », hors accolades. */
export function splitBibtexNames(value: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < value.length) {
    const char = value[i] ?? "";
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(char) && /^\s+and\s/i.test(value.slice(i, i + 6))) {
      names.push(current);
      current = "";
      i += value.slice(i).match(/^\s+and\s+/i)?.[0].length ?? 1;
      continue;
    }
    current += char;
    i += 1;
  }
  names.push(current);
  return names.map((name) => clean(latexToText(name))).filter((name) => name && name.toLowerCase() !== "others");
}

function bibtexSourceType(type: string): SourceType {
  switch (type) {
    case "article":
      return "article";
    case "book":
    case "booklet":
    case "mvbook":
      return "book";
    case "inbook":
    case "incollection":
    case "bookinbook":
      return "chapter";
    case "phdthesis":
    case "mastersthesis":
    case "thesis":
      return "thesis";
    case "techreport":
    case "report":
      return "report";
    case "inproceedings":
    case "conference":
    case "proceedings":
      return "conference";
    case "online":
    case "electronic":
    case "www":
      return "web";
    default:
      return "other";
  }
}

function year(value: string | undefined): string {
  return /\d{4}/.exec(value ?? "")?.[0] ?? (value ? clean(value) : "");
}

function isoDate(value: string | undefined): string {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(clean(value ?? ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

/**
 * Valeur brute bornée avant tout traitement. Au-delà de quatre fois la borne
 * du champ (place laissée aux commandes d'accent), la valeur est ramenée à la
 * borne plus un caractère, sans être décodée : le schéma la refuse alors, au
 * lieu d'accepter un texte tronqué en silence.
 */
function bounded(value: string | undefined, max: number): { raw: string; over: boolean } {
  const raw = value ?? "";
  return raw.length > max * 4 ? { raw: raw.slice(0, max + 1), over: true } : { raw, over: false };
}

function bibtexToReference(entry: RawEntry): ImportedReference {
  const get = (...names: string[]) => {
    for (const name of names) {
      const value = entry.fields.get(name);
      if (value !== undefined && value.trim()) return value;
    }
    return undefined;
  };
  const text = (max: number, ...names: string[]) => {
    const { raw, over } = bounded(get(...names), max);
    return over ? raw : clean(latexToText(raw));
  };
  const verbatim = (max: number, name: string) => {
    const { raw, over } = bounded(get(name), max);
    return over ? raw : clean(raw);
  };
  const sourceType = bibtexSourceType(entry.type);
  const pages = text(50, "pages").replace(/\s*[–—]\s*/g, "-");

  return {
    ...EMPTY,
    sourceType,
    title: text(500, "title"),
    authors: splitBibtexNames(get("author") ?? ""),
    publicationYear: year(bounded(get("year") ?? get("date"), 50).raw),
    containerTitle: text(300, "journal", "journaltitle", "booktitle"),
    publisher:
      sourceType === "thesis" || sourceType === "report"
        ? text(200, "school", "institution", "publisher")
        : text(200, "publisher", "organization"),
    volume: text(50, "volume"),
    issue: text(50, "number", "issue"),
    pages,
    // DOI et adresse : verbatim, ni accent ni commande à traduire.
    doi: verbatim(255, "doi"),
    url: verbatim(2000, "url"),
    accessedOn: isoDate(bounded(get("urldate"), 50).raw),
  };
}

// -----------------------------------------------------------------------------
// RIS
// -----------------------------------------------------------------------------

type RisEntry = { fields: [string, string][]; tooManyFields: boolean };

export function readRis(text: string): RisEntry[] {
  const entries: RisEntry[] = [];
  let current: RisEntry | null = null;
  let start = 0;
  while (start <= text.length && entries.length <= IMPORT_MAX_ENTRIES) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, Math.min(end, start + MAX_RIS_LINE)).replace(/\r$/, "");
    start = end + 1;

    const match = /^([A-Z][A-Z0-9]) {2}-(?: (.*))?$/.exec(line.replace(/^\u{FEFF}/u, ""));
    if (!match) {
      // Ligne de suite : rattachée à la valeur précédente.
      const last = current?.fields[current.fields.length - 1];
      if (last && line.trim() && last[1].length + line.length < MAX_VALUE) last[1] += ` ${line.trim()}`;
      if (end >= text.length) break;
      continue;
    }
    const tag = match[1] ?? "";
    const value = match[2] ?? "";
    if (tag === "TY") {
      current = { fields: [["TY", value]], tooManyFields: false };
      entries.push(current);
    } else if (tag === "ER") {
      current = null;
    } else if (current) {
      if (current.fields.length >= MAX_FIELDS * 2) current.tooManyFields = true;
      else current.fields.push([tag, value]);
    }
    if (end >= text.length) break;
  }
  return entries;
}

function risSourceType(type: string): SourceType {
  switch (type.trim().toUpperCase()) {
    case "JOUR":
    case "JFULL":
    case "EJOUR":
    case "MGZN":
    case "NEWS":
    case "ABST":
      return "article";
    case "BOOK":
    case "EBOOK":
    case "EDBOOK":
      return "book";
    case "CHAP":
    case "ECHAP":
      return "chapter";
    case "THES":
      return "thesis";
    case "RPRT":
    case "GOVDOC":
      return "report";
    case "CONF":
    case "CPAPER":
      return "conference";
    case "ELEC":
    case "WEB":
    case "BLOG":
      return "web";
    default:
      return "other";
  }
}

function risToReference(entry: RisEntry): ImportedReference {
  const all = (...tags: string[]) =>
    entry.fields.filter(([tag]) => tags.includes(tag)).map(([, value]) => clean(value)).filter(Boolean);
  const first = (...tags: string[]) => {
    for (const tag of tags) {
      const value = all(tag)[0];
      if (value) return value;
    }
    return "";
  };
  const startPage = first("SP");
  const endPage = first("EP");
  const pages = startPage && endPage && !startPage.includes("-") ? `${startPage}-${endPage}` : startPage;

  return {
    ...EMPTY,
    sourceType: risSourceType(first("TY")),
    title: first("TI", "T1", "CT"),
    authors: all("AU", "A1"),
    publicationYear: year(first("PY", "Y1", "DA")),
    containerTitle: first("JO", "JF", "T2", "BT", "JA"),
    publisher: first("PB"),
    volume: first("VL"),
    issue: first("IS"),
    pages,
    doi: first("DO"),
    url: first("UR"),
    accessedOn: "",
  };
}

// -----------------------------------------------------------------------------
// Validation et rapport
// -----------------------------------------------------------------------------

const DROPPABLE: DroppedField[] = [
  "publicationYear",
  "containerTitle",
  "publisher",
  "volume",
  "issue",
  "pages",
  "doi",
  "url",
  "accessedOn",
];

function label(reference: ImportedReference): string {
  return reference.title.slice(0, 120);
}

/** Valide une référence ; écarte les champs facultatifs invalides. */
export function validateReference(
  reference: ImportedReference,
): { ok: true; reference: ImportedReference; dropped: DroppedField[] } | { ok: false; code: RejectionCode } {
  if (!reference.title) return { ok: false, code: "missing_title" };
  let candidate = reference;
  const dropped: DroppedField[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = sourceSchema.safeParse(candidate);
    if (parsed.success) return { ok: true, reference: candidate, dropped };
    const fields = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")));
    const blocking = [...fields].filter((field) => !(DROPPABLE as string[]).includes(field));
    if (blocking.length > 0) return { ok: false, code: "invalid" };
    candidate = { ...candidate };
    for (const field of fields) {
      const name = field as DroppedField;
      candidate[name] = "";
      dropped.push(name);
    }
  }
  return { ok: false, code: "invalid" };
}

function normalizedTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Analyse un fichier BibTeX ou RIS et rend les entrées importables et les refus. */
export function parseReferences(text: string, format?: ImportFormat): ParseResult {
  if (utf8Length(text) > IMPORT_MAX_BYTES) {
    return { format: null, accepted: [], rejected: [], tooLarge: true };
  }
  const detected = format ?? detectFormat(text);
  if (!detected) return { format: null, accepted: [], rejected: [], tooLarge: false };

  const bibtex = detected === "bibtex" ? scanBibtex(text) : { entries: [], overBudget: false };
  if (bibtex.overBudget) return { format: null, accepted: [], rejected: [], tooLarge: true };

  const raw =
    detected === "bibtex"
      ? bibtex.entries.map((entry) => ({
          reference: bibtexToReference(entry),
          problem: entry.syntax ? ("syntax" as const) : entry.tooManyFields ? ("too_many_fields" as const) : null,
        }))
      : readRis(text).map((entry) => ({
          reference: risToReference(entry),
          problem: entry.tooManyFields ? ("too_many_fields" as const) : null,
        }));

  const accepted: AcceptedEntry[] = [];
  const rejected: RejectedEntry[] = [];
  const seen = new Set<string>();

  raw.forEach(({ reference, problem }, index) => {
    if (index >= IMPORT_MAX_ENTRIES) {
      rejected.push({ index, label: label(reference), code: "too_many_entries" });
      return;
    }
    if (problem) {
      rejected.push({ index, label: label(reference), code: problem });
      return;
    }
    const checked = validateReference(reference);
    if (!checked.ok) {
      rejected.push({ index, label: label(reference), code: checked.code });
      return;
    }
    const parsed = sourceSchema.parse(checked.reference);
    const keys = [
      parsed.doi ? `doi:${parsed.doi.toLowerCase()}` : null,
      `title:${normalizedTitle(parsed.title)}|${parsed.publicationYear ?? ""}`,
    ].filter((key): key is string => key !== null);
    if (keys.some((key) => seen.has(key))) {
      rejected.push({ index, label: label(reference), code: "duplicate_in_file" });
      return;
    }
    for (const key of keys) seen.add(key);
    accepted.push({
      index,
      reference: checked.reference,
      dropped: checked.dropped,
      payload: toSourcePayload(parsed),
    });
  });

  return { format: detected, accepted, rejected, tooLarge: false };
}
