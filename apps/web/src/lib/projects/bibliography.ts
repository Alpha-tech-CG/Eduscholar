// Bibliographie d'un projet au format APA (7e édition, forme de base).
//
// Module pur : il met en forme les sources telles que l'étudiant les a saisies.
// Rien n'est inventé ni deviné — ni auteur, ni date, ni titre. Un champ absent
// donne la mention convenue (« s. d. ») et un signalement, jamais une valeur
// supposée. Les noms d'auteurs ne sont abrégés que s'ils sont saisis sous la
// forme « Nom, Prénom » : sans virgule, un nom est repris tel quel, car rien
// ne permet de savoir où finit le prénom (ni s'il s'agit d'un organisme).

export type BibliographySource = {
  id: string;
  sourceType: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  containerTitle: string | null;
  publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url: string | null;
  accessedOn: string | null;
};

export type BibliographyLocale = "fr" | "en";

export type Segment = { text: string; italic?: boolean };

export type ReferenceIssue =
  | "missing_authors"
  | "missing_year"
  | "missing_container"
  | "missing_publisher"
  | "missing_pages"
  | "missing_locator"
  | "author_not_inverted"
  | "duplicate";

export type Reference = {
  sourceId: string;
  segments: Segment[];
  issues: ReferenceIssue[];
};

const WORDS = {
  fr: {
    and: "et",
    noDate: "s. d.",
    inBook: "Dans",
    // En français, « p. » vaut pour une page comme pour plusieurs.
    pages: (value: string) => `p. ${value}`,
    thesis: "Thèse ou mémoire",
    retrieved: (date: string, url: string) => `Consulté le ${date}, à l'adresse ${url}`,
    months: [
      "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
      "octobre", "novembre", "décembre",
    ],
    date: (day: number, month: string, year: number) =>
      `${day === 1 ? "1er" : String(day)} ${month} ${year}`,
  },
  en: {
    and: "&",
    noDate: "n.d.",
    inBook: "In",
    pages: (value: string) => (/[-–—,]/.test(value) ? `pp. ${value}` : `p. ${value}`),
    thesis: "Thesis or dissertation",
    retrieved: (date: string, url: string) => `Retrieved ${date}, from ${url}`,
    months: [
      "January", "February", "March", "April", "May", "June", "July", "August", "September",
      "October", "November", "December",
    ],
    date: (day: number, month: string, year: number) => `${month} ${day}, ${year}`,
  },
} as const;

/**
 * Un auteur saisi « Nom, Prénom Second » devient « Nom, P. S. ». Sans virgule,
 * le nom est repris tel quel.
 */
export function formatAuthor(name: string): { text: string; inverted: boolean } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const comma = trimmed.indexOf(",");
  if (comma <= 0 || comma === trimmed.length - 1) return { text: trimmed, inverted: false };

  const family = trimmed.slice(0, comma).trim();
  const given = trimmed.slice(comma + 1).trim();
  if (!family || !given) return { text: trimmed, inverted: false };

  // Chaque prénom donne une initiale ; un prénom composé garde son trait d'union.
  const initials = given
    .split(" ")
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .filter(Boolean)
        .map((piece) => `${Array.from(piece)[0]?.toLocaleUpperCase() ?? ""}.`)
        .join("-"),
    )
    .join(" ");
  return { text: `${family}, ${initials}`, inverted: true };
}

function joinAuthors(names: string[], locale: BibliographyLocale): string {
  const and = WORDS[locale].and;
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ${and} ${names[1]}`;
  // Au-delà de vingt auteurs : les dix-neuf premiers, des points de suspension, le dernier.
  if (names.length > 20) {
    return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, ${and} ${names[names.length - 1]}`;
}

/** Ajoute un point final s'il n'y a pas déjà une ponctuation forte. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function formatDate(value: string, locale: BibliographyLocale): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const name = WORDS[locale].months[month - 1];
  if (!name || day < 1 || day > 31) return null;
  return WORDS[locale].date(day, name, year);
}

/** Adresse de la source : le DOI, sous sa forme de lien, prime sur l'adresse web. */
function locator(source: BibliographySource): string | null {
  if (source.doi) return `https://doi.org/${source.doi}`;
  if (source.url && /^https?:\/\//.test(source.url)) return source.url;
  return null;
}

const NEEDS_CONTAINER = new Set(["article", "chapter", "conference"]);
const NEEDS_PUBLISHER = new Set(["book", "thesis", "report"]);

/** Met en forme une source. Les doublons sont signalés par `buildBibliography`. */
export function formatReference(source: BibliographySource, locale: BibliographyLocale): Reference {
  const words = WORDS[locale];
  const issues: ReferenceIssue[] = [];
  const segments: Segment[] = [];
  const push = (text: string, italic = false) => {
    if (text) segments.push(italic ? { text, italic } : { text });
  };

  const authors = source.authors.map(formatAuthor);
  if (authors.length === 0) issues.push("missing_authors");
  else if (authors.some((author) => !author.inverted)) issues.push("author_not_inverted");
  if (source.publicationYear === null) issues.push("missing_year");

  const year = `(${source.publicationYear ?? words.noDate}).`;
  const title = source.title.trim();
  const type = source.sourceType;
  // Le titre d'un document autonome est en italique ; celui d'une partie d'un
  // ensemble (article, chapitre, communication) ne l'est pas.
  const standalone = !NEEDS_CONTAINER.has(type);

  if (authors.length > 0) {
    push(`${sentence(joinAuthors(authors.map((author) => author.text), locale))} ${year} `);
    if (type === "thesis") {
      push(title, true);
      push(` [${[words.thesis, source.publisher].filter(Boolean).join(", ")}].`);
    } else {
      push(standalone ? title : sentence(title), standalone);
      // Pas de point après un titre qui se termine déjà par une ponctuation forte.
      if (standalone && !/[.!?…]$/.test(title)) push(".");
    }
  } else {
    // Sans auteur, le titre prend la place de l'auteur.
    push(title, standalone);
    if (type === "thesis") push(` [${[words.thesis, source.publisher].filter(Boolean).join(", ")}]`);
    push(type !== "thesis" && /[.!?…]$/.test(title) ? ` ${year}` : `. ${year}`);
  }

  if (NEEDS_CONTAINER.has(type) && !source.containerTitle) issues.push("missing_container");
  if (NEEDS_PUBLISHER.has(type) && !source.publisher) issues.push("missing_publisher");

  if (type === "article" || type === "conference") {
    if (source.containerTitle) {
      push(" ");
      push(source.containerTitle, true);
      if (source.volume) {
        push(", ");
        push(source.volume, true);
      }
      if (source.issue) push(`(${source.issue})`);
      if (source.pages) push(`, ${source.pages}`);
      push(".");
    } else if (source.pages) {
      push(` ${source.pages}.`);
    }
  } else if (type === "chapter") {
    if (!source.pages) issues.push("missing_pages");
    if (source.containerTitle) {
      push(` ${words.inBook} `);
      push(source.containerTitle, true);
      if (source.pages) push(` (${words.pages(source.pages)})`);
      push(".");
    }
    if (source.publisher) push(` ${sentence(source.publisher)}`);
  } else if (type === "web") {
    if (source.containerTitle) push(` ${sentence(source.containerTitle)}`);
  } else if (type !== "thesis") {
    if (source.publisher) push(` ${sentence(source.publisher)}`);
  }

  const address = locator(source);
  if (address) {
    const accessed = type === "web" && source.accessedOn ? formatDate(source.accessedOn, locale) : null;
    push(` ${accessed ? words.retrieved(accessed, address) : address}`);
  } else if (type === "web") {
    issues.push("missing_locator");
  }

  return { sourceId: source.id, segments, issues };
}

/** Texte brut d'une référence, sans italique. */
export function referenceText(reference: Reference): string {
  return reference.segments.map((segment) => segment.text).join("");
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Clés sous lesquelles deux sources sont tenues pour la même. */
function duplicateKeys(source: BibliographySource): string[] {
  const keys: string[] = [];
  if (source.doi) keys.push(`doi:${source.doi.toLowerCase()}`);
  const title = normalize(source.title);
  if (title) keys.push(`title:${title}|${source.publicationYear ?? ""}`);
  return keys;
}

export type Bibliography = {
  references: Reference[];
  /** Nombre de références portant au moins un signalement. */
  flagged: number;
};

/**
 * Bibliographie triée (auteur, puis année, puis titre), avec signalement des
 * références incomplètes et des doublons. Chaque source saisie y figure, une
 * fois, et rien d'autre.
 */
export function buildBibliography(
  sources: BibliographySource[],
  locale: BibliographyLocale,
): Bibliography {
  const counts = new Map<string, number>();
  for (const source of sources) {
    for (const key of duplicateKeys(source)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const entries = sources.map((source) => {
    const reference = formatReference(source, locale);
    if (duplicateKeys(source).some((key) => (counts.get(key) ?? 0) > 1)) {
      reference.issues.push("duplicate");
    }
    // Classement à la lettre, sur le premier auteur tel qu'il est affiché, ou
    // sur le titre s'il n'y a pas d'auteur.
    const first = source.authors[0] ? formatAuthor(source.authors[0]).text : source.title;
    return { reference, first, year: source.publicationYear ?? 0, title: source.title };
  });

  entries.sort(
    (a, b) =>
      collator.compare(a.first, b.first) || a.year - b.year || collator.compare(a.title, b.title),
  );

  const references = entries.map((entry) => entry.reference);
  return { references, flagged: references.filter((reference) => reference.issues.length > 0).length };
}
