import { z } from "zod";

// Normalisation d'une réponse Crossref (docs/product/authorized-sources.md).
//
// Règles : seules des métadonnées sont retenues ; un champ absent reste vide ;
// rien n'est déduit ni complété. Le résumé n'est pas repris : il peut être
// protégé par le droit d'auteur, indépendamment de la licence des métadonnées.
// Ce module est pur : il ne fait aucun appel réseau.

// Ni espace, ni caractère de contrôle, de format ou demi-codet isolé.
export const DOI_PATTERN = /^10\.[0-9]{4,9}\/[^\s\p{Cc}\p{Cf}\p{Cs}]+$/u;

/** Accepte un DOI nu, préfixé « doi: » ou donné sous forme de lien doi.org. */
export function parseDoi(input: string): string | null {
  const value = input
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  if (value.length > 255 || !DOI_PATTERN.test(value)) return null;
  return value;
}

const workSchema = z.object({
  DOI: z.string(),
  type: z.string().optional(),
  title: z.array(z.string()).optional(),
  author: z
    .array(
      z.object({
        given: z.string().optional(),
        family: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  issued: z
    .object({ "date-parts": z.array(z.array(z.number().nullable())).optional() })
    .optional(),
  language: z.string().optional(),
  license: z
    .array(
      z.object({
        URL: z.string(),
        "content-version": z.string().optional(),
        start: z.object({ "date-time": z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const responseSchema = z.object({ status: z.literal("ok"), message: workSchema });

// Types Crossref repris, vers les types actifs du catalogue. Tout autre type
// est refusé plutôt que classé de force.
const TYPES = new Map<string, string>(Object.entries({
  "journal-article": "article",
  "proceedings-article": "article",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  dissertation: "thesis",
}));

// Licences Creative Commons reconnues, vers les codes du référentiel.
const LICENSES: [RegExp, string][] = [
  [/^creativecommons\.org\/publicdomain\/zero\/1\.0$/, "cc0-1.0"],
  [/^creativecommons\.org\/licenses\/by\/4\.0$/, "cc-by-4.0"],
  [/^creativecommons\.org\/licenses\/by-sa\/4\.0$/, "cc-by-sa-4.0"],
  [/^creativecommons\.org\/licenses\/by-nd\/4\.0$/, "cc-by-nd-4.0"],
  [/^creativecommons\.org\/licenses\/by-nc\/4\.0$/, "cc-by-nc-4.0"],
  [/^creativecommons\.org\/licenses\/by-nc-sa\/4\.0$/, "cc-by-nc-sa-4.0"],
  [/^creativecommons\.org\/licenses\/by-nc-nd\/4\.0$/, "cc-by-nc-nd-4.0"],
];

/**
 * Texte d'une ligne : balises de mise en forme retirées (Crossref en place dans
 * certains titres), caractères de contrôle et de format retirés, espaces réduits.
 */
function cleanLine(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/<[^>]{0,200}>/g, "")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Coupe par caractère, jamais au milieu d'une paire de substitution.
  return Array.from(cleaned).slice(0, maxLength).join("").trim();
}

function licenseCode(licenses: z.infer<typeof workSchema>["license"], now: Date): string {
  const codes = new Set<string>();
  for (const license of licenses ?? []) {
    // Seule compte la licence déclarée pour la version publiée ; celle du
    // manuscrit accepté, de la fouille de textes ou d'une version non précisée
    // ne dit rien de sûr du document diffusé.
    if (license["content-version"] !== "vor") continue;
    // Licence sous embargo : elle ne s'applique pas encore.
    const start = license.start?.["date-time"];
    if (start !== undefined) {
      const startsAt = Date.parse(start);
      if (Number.isNaN(startsAt) || startsAt > now.getTime()) {
        codes.add("unknown");
        continue;
      }
    }

    const url = license.URL.trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/(legalcode(\.[a-z-]+)?|deed(\.[a-z-]+)?)?$/, "");
    const match = LICENSES.find(([pattern]) => pattern.test(url));
    // Une licence non reconnue rend l'ensemble incertain.
    codes.add(match ? match[1] : "unknown");
  }
  const [only] = [...codes];
  return codes.size === 1 && only ? only : "unknown";
}

export type NormalizedWork = {
  doi: string;
  typeCode: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  /** Code de langue annoncé par la source, s'il y en a un. */
  languageCode: string | null;
  licenseCode: string;
  officialUrl: string;
};

export type NormalizeResult =
  | { ok: true; work: NormalizedWork }
  | { ok: false; reason: "invalid_response" | "doi_mismatch" | "unsupported_type" | "no_title" };

/** Transforme la réponse de `/works/{doi}` en champs du catalogue. */
export function normalizeCrossrefWork(
  body: unknown,
  requestedDoi: string,
  now: Date = new Date(),
): NormalizeResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalid_response" };
  const work = parsed.data.message;

  // La fiche décrit le DOI demandé, pas un autre.
  const doi = parseDoi(work.DOI);
  if (!doi || doi !== requestedDoi) return { ok: false, reason: "doi_mismatch" };

  const typeCode = work.type ? TYPES.get(work.type) : undefined;
  if (!typeCode) return { ok: false, reason: "unsupported_type" };

  const title = cleanLine(work.title?.[0] ?? "", 500);
  if (title.length < 3) return { ok: false, reason: "no_title" };

  // Le catalogue n'admet pas deux fois le même nom : deux auteurs strictement
  // homonymes n'apparaissent qu'une fois.
  const authors = [
    ...new Set(
      (work.author ?? [])
        .map((author) =>
          cleanLine(author.name ?? [author.given, author.family].filter(Boolean).join(" "), 200),
        )
        .filter((name) => name.length > 0),
    ),
  ].slice(0, 50);

  const year = work.issued?.["date-parts"]?.[0]?.[0];
  const publicationYear =
    typeof year === "number" && Number.isInteger(year) && year >= 1400 && year <= 2100
      ? year
      : null;

  const language = work.language?.trim().toLowerCase().split("-")[0] ?? "";

  return {
    ok: true,
    work: {
      doi,
      typeCode,
      title,
      authors,
      publicationYear,
      languageCode: /^[a-z]{2,3}$/.test(language) ? language : null,
      licenseCode: licenseCode(work.license, now),
      // Lien du résolveur officiel des DOI : construit à partir du seul DOI,
      // dont chaque segment est encodé.
      officialUrl: `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
    },
  };
}
