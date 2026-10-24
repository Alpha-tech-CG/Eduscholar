import { describe, expect, it } from "vitest";
import {
  csvCell,
  escapeBibtex,
  escapeBibtexVerbatim,
  isLibraryExportFormat,
  libraryExportFileName,
  toApaText,
  toBibtex,
  toCsv,
  toRis,
  type LibraryEntry,
} from "@/lib/library/citation-export";
import { readBibtex } from "@/lib/library/reference-import";

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    typeCode: "article",
    title: "Titre de test",
    authors: ["Diallo, Aminata"],
    publicationYear: 2021,
    institutionName: null,
    thesisDegree: null,
    languageCode: "fr",
    doi: "10.1234/abc",
    officialUrl: "https://exemple.org/a",
    note: null,
    tags: [],
    ...overrides,
  };
}

describe("formats admis", () => {
  it("n'admet que les quatre formats prévus", () => {
    for (const format of ["bib", "ris", "csv", "apa"]) expect(isLibraryExportFormat(format)).toBe(true);
    for (const format of ["docx", "BIB", "", "../bib", null]) expect(isLibraryExportFormat(format)).toBe(false);
  });
});

describe("BibTeX", () => {
  it("échappe les caractères spéciaux de LaTeX et les accolades", () => {
    expect(escapeBibtex("50 % & $5 #1 a_b ^ ~")).toBe(
      "50 \\% \\& \\$5 \\#1 a\\_b \\textasciicircum{} \\textasciitilde{}",
    );
    expect(escapeBibtex("}{\\")).toBe("\\}\\{\\textbackslash{}");
  });

  it("ne laisse pas une valeur hostile fermer le champ ni ouvrir une entrée", () => {
    const hostile = entry({
      title: "Titre}, author = {Pirate}, x = {",
      note: "fin\n@misc{injection,\n title = {x}}",
      authors: ["Nom} and {Autre, Prénom"],
      tags: ["a}b"],
    });
    const bib = toBibtex([hostile]);
    // Une seule entrée, un seul champ author, et pas de saut de ligne dans les valeurs.
    expect(bib.match(/^@/gm)).toHaveLength(1);
    expect(bib.match(/^\s+author =/gm)).toHaveLength(1);
    expect(bib).not.toContain("\n@misc");
    // Relu par notre propre lecteur : la valeur revient entière.
    const [read] = readBibtex(bib);
    expect(read?.fields.get("title")).toBe("Titre\\}, author = \\{Pirate\\}, x = \\{");
    expect(read?.fields.size).toBe(8);
  });

  it("protège un nom sans virgule et sépare les auteurs par « and »", () => {
    const bib = toBibtex([entry({ authors: ["Organisation mondiale de la santé", "Ba, Ousmane"] })]);
    expect(bib).toContain("author = {{Organisation mondiale de la santé} and Ba, Ousmane}");
  });

  it("garde doi et url verbatim, accolades encodées", () => {
    expect(escapeBibtexVerbatim("10.1000/a_b{c}\\")).toBe("10.1000/a_b%7Bc%7D%5C");
  });

  it("rend des clés de citation ASCII et uniques", () => {
    const bib = toBibtex([entry({ authors: ["Ndiaye, Éric"] }), entry({ authors: ["Ndiaye, Awa"] })]);
    expect(bib).toContain("@article{Ndiaye2021,");
    expect(bib).toContain("@article{Ndiaye2021a,");
  });

  it("choisit le type d'entrée selon le type et le diplôme", () => {
    expect(toBibtex([entry({ typeCode: "memoir", institutionName: "UCAD" })])).toMatch(
      /^@mastersthesis\{[^]*school = \{UCAD\}/,
    );
    expect(toBibtex([entry({ typeCode: "thesis", thesisDegree: "doctorate" })])).toMatch(/^@phdthesis/);
    expect(toBibtex([entry({ typeCode: "course" })])).toMatch(/^@misc/);
  });

  it("exporte tags et note personnels", () => {
    const bib = toBibtex([entry({ tags: ["méthode", "terrain"], note: "À relire" })]);
    expect(bib).toContain("keywords = {méthode, terrain}");
    expect(bib).toContain("annote = {À relire}");
  });
});

describe("RIS", () => {
  it("écrit une valeur par ligne, sans saut de ligne injecté", () => {
    const ris = toRis([
      entry({ title: "Titre\r\nER  - \r\nTY  - JOUR", note: "a\nb\u{2028}c", tags: ["x\ny"] }),
    ]);
    const lines = ris.split("\r\n");
    expect(lines.filter((line) => line.startsWith("TY  - "))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("ER  - "))).toHaveLength(1);
    expect(lines).toContain("TI  - Titre ER - TY - JOUR");
    expect(lines).toContain("N1  - a b c");
    expect(lines).toContain("KW  - x y");
  });

  it("reprend auteurs, année, DOI et adresse", () => {
    const ris = toRis([entry({ authors: ["Diallo, Aminata", "Ba, Ousmane"] })]);
    expect(ris).toContain("TY  - JOUR\r\nAU  - Diallo, Aminata\r\nAU  - Ba, Ousmane\r\nTI  - Titre de test\r\nPY  - 2021");
    expect(ris).toContain("DO  - 10.1234/abc");
    expect(ris).toContain("UR  - https://exemple.org/a");
  });

  it("n'exporte pas une adresse qui n'est pas http(s)", () => {
    expect(toRis([entry({ officialUrl: "javascript:alert(1)" })])).not.toContain("UR  -");
  });
});

describe("CSV", () => {
  it("neutralise les formules en tête de cellule", () => {
    for (const value of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "  =1", "\u{FF1D}1"]) {
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    }
    expect(csvCell("Texte")).toBe('"Texte"');
    // Formule en tête d'un segment : la cellule entière est neutralisée.
    for (const value of ["a;=1+1", "a,=1+1", "a, -1", `a${String.fromCharCode(9)}@x`, `a${String.fromCharCode(10)}+1`]) {
      expect(csvCell(value).startsWith(`"'`), value).toBe(true);
    }
    expect(csvCell("Diallo, Aminata; Ba, Ousmane")).toBe('"Diallo, Aminata; Ba, Ousmane"');
  });

  it("double les guillemets et garde la cellule entière", () => {
    expect(csvCell('Il dit "oui",\nensuite')).toBe('"Il dit ""oui"",\nensuite"');
  });

  it("rend une ligne d'en-tête puis une ligne par fiche", () => {
    const csv = toCsv([entry({ title: '=HYPERLINK("http://x")', tags: ["a", "b"] })]);
    expect(csv.startsWith("\u{FEFF}")).toBe(true);
    const rows = csv.slice(1).trimEnd().split("\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(rows[1]).toContain('"a; b"');
  });
});

describe("APA", () => {
  it("réutilise le formateur des projets", () => {
    const text = toApaText(
      [entry({ authors: ["Diallo, Aminata"], title: "Étude de cas", typeCode: "book", doi: null, officialUrl: null })],
      "fr",
    );
    expect(text.trim()).toBe("Diallo, A. (2021). Étude de cas.");
  });

  it("une thèse reprend son établissement", () => {
    const text = toApaText(
      [entry({ typeCode: "memoir", institutionName: "UCAD", doi: null, officialUrl: null })],
      "fr",
    );
    expect(text).toContain("[Thèse ou mémoire, UCAD]");
  });
});

describe("nom du fichier", () => {
  it("ne garde que des caractères sûrs", () => {
    expect(libraryExportFileName('Mémoire "chap. 2"\r\n; x', "bib")).toBe("memoire-chap-2-x.bib");
    expect(libraryExportFileName("…", "apa")).toBe("bibliotheque.txt");
  });
});
