import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_BYTES,
  detectFormat,
  latexToText,
  parseReferences,
  readBibtex,
  splitBibtexNames,
} from "@/lib/library/reference-import";

const BIB = String.raw`
@string{jrn = "Revue africaine"}
@comment{ ignoré @article{faux, title={non}} }
@article{diallo2021,
  author = {Diallo, Aminata and Ba, Ousmane and {Organisation mondiale de la sant\'e}},
  title = {L'{\'e}cole {\`a} l'{\'E}preuve : \textit{cas} du S{\'e}n{\'e}gal},
  journal = jrn # " de sociologie",
  year = 2021,
  volume = {12}, number = {3}, pages = {45--67},
  doi = {https://doi.org/10.1234/ABC_def},
  url = {https://exemple.org/a?b=1&c=2}
}
@book(ndiaye2019,
  author = "Ndiaye, Fatou",
  title = "Un livre {"}entre guillemets{"}",
  publisher = {Presses \& Cie},
  year = {2019}
)
@phdthesis{sow, author={Sow, Moussa}, title={Th\`ese}, school={UCAD}, year={2018}}
`;

describe("détection du format", () => {
  it("reconnaît BibTeX et RIS", () => {
    expect(detectFormat(BIB)).toBe("bibtex");
    expect(detectFormat("TY  - JOUR\nTI  - x\nER  - \n")).toBe("ris");
    expect(detectFormat("du texte sans référence")).toBeNull();
  });
});

describe("BibTeX", () => {
  it("lit entrées, macros, concaténations et parenthèses", () => {
    const result = parseReferences(BIB);
    expect(result.format).toBe("bibtex");
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(3);
    const [article, book, thesis] = result.accepted.map((entry) => entry.reference);
    expect(article).toMatchObject({
      sourceType: "article",
      title: "L'école à l'Épreuve : cas du Sénégal",
      authors: ["Diallo, Aminata", "Ba, Ousmane", "Organisation mondiale de la santé"],
      containerTitle: "Revue africaine de sociologie",
      publicationYear: "2021",
      volume: "12",
      issue: "3",
      pages: "45-67",
      url: "https://exemple.org/a?b=1&c=2",
    });
    // Le DOI est ramené à sa forme nue, en minuscules par la base.
    expect(result.accepted[0]?.payload.doi).toBe("10.1234/ABC_def");
    expect(book).toMatchObject({ sourceType: "book", publisher: "Presses & Cie", title: 'Un livre "entre guillemets"' });
    expect(thesis).toMatchObject({ sourceType: "thesis", publisher: "UCAD", title: "Thèse" });
  });

  it("ne coupe pas un nom protégé par des accolades", () => {
    expect(splitBibtexNames("{Barnes and Noble} and Smith, J.")).toEqual(["Barnes and Noble", "Smith, J."]);
    expect(splitBibtexNames("Doe, J. and others")).toEqual(["Doe, J."]);
  });

  it("ne traduit que des accents et retire les autres commandes", () => {
    expect(latexToText("\\input{/etc/passwd} \\write18{rm -rf} \\c{c}a \\ss{} \\o")).toBe("/etc/passwd 18rm -rf ça ß ø");
  });

  it("refuse une entrée sans titre et écarte un champ facultatif invalide", () => {
    const result = parseReferences(
      "@article{a, author={X, Y}}\n@article{b, title={Bon}, year={à paraître}, url={javascript:alert(1)}, doi={pas un doi}}",
    );
    expect(result.rejected).toEqual([{ index: 0, label: "", code: "missing_title" }]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.dropped.sort()).toEqual(["doi", "publicationYear", "url"]);
    expect(result.accepted[0]?.payload).toMatchObject({ title: "Bon", url: "", doi: "", publication_year: "" });
  });

  it("signale les doublons dans le fichier", () => {
    const result = parseReferences(
      "@article{a, title={Même titre}, year=2020}\n@article{b, title={Même  TITRE}, year=2020}\n@article{c, title={Autre}, doi={10.1234/x}}\n@book{d, title={Encore}, doi={10.1234/X}}",
    );
    expect(result.accepted.map((entry) => entry.index)).toEqual([0, 2]);
    expect(result.rejected.map((entry) => [entry.index, entry.code])).toEqual([
      [1, "duplicate_in_file"],
      [3, "duplicate_in_file"],
    ]);
  });

  it("reprend après une entrée mal formée", () => {
    const result = parseReferences("@article{a, title={Non fermé\n@article{b, title={Correct}}");
    // L'entrée a est refusée ou absorbée ; l'entrée b n'est jamais perdue pour autant.
    expect(result.accepted.some((entry) => entry.reference.title === "Correct") || result.rejected.length > 0).toBe(true);
    expect(parseReferences("@article{a, title = }\n@article{b, title={Correct}}").accepted.map((e) => e.reference.title)).toEqual(["Correct"]);
  });

  it("borne la profondeur des accolades", () => {
    const deep = `@article{a, title={${"{".repeat(100)}x${"}".repeat(100)}}}\n@article{b, title={Correct}}`;
    const result = parseReferences(deep);
    expect(result.rejected[0]?.code).toBe("syntax");
    expect(result.accepted.map((entry) => entry.reference.title)).toEqual(["Correct"]);
  });

  it("borne le nombre de champs", () => {
    const fields = Array.from({ length: 80 }, (_, i) => `f${i} = {v}`).join(", ");
    const result = parseReferences(`@article{a, title={T}, ${fields}}`);
    expect(result.rejected[0]?.code).toBe("too_many_fields");
  });

  it("ne lit pas plus de 500 entrées", () => {
    const text = Array.from({ length: 520 }, (_, i) => `@misc{k${i}, title={Titre ${i}}}`).join("\n");
    const result = parseReferences(text);
    expect(result.accepted).toHaveLength(500);
    expect(result.rejected).toEqual([{ index: 500, label: "Titre 500", code: "too_many_entries" }]);
    expect(readBibtex(text).length).toBeLessThanOrEqual(501);
  });

  it("refuse un fichier de plus d'un mégaoctet sans l'analyser", () => {
    const result = parseReferences(`@misc{a, title={${"é".repeat(IMPORT_MAX_BYTES / 2)}}}`);
    expect(result).toEqual({ format: null, accepted: [], rejected: [], tooLarge: true });
  });

  it("refuse les caractères de contrôle et de sens d'écriture dans un titre", () => {
    const result = parseReferences("@misc{a, title={Nom \u202Edéguisé\u0007}}");
    expect(result.accepted[0]?.reference.title).toBe("Nom déguisé");
  });

  it("résiste à une entrée hostile et volumineuse en temps borné", () => {
    const hostile = `@article{${"x".repeat(5000)}, title="${'\\"'.repeat(50000)}`;
    const started = Date.now();
    parseReferences(hostile);
    parseReferences("@".repeat(200000));
    parseReferences(`@a{b,${"c=d#".repeat(100000)}}`);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("RIS", () => {
  const RIS = [
    "TY  - JOUR",
    "AU  - Diallo, Aminata",
    "A1  - Ba, Ousmane",
    "TI  - Titre de l'article",
    "T2  - Revue",
    "PY  - 2020/05/01/",
    "VL  - 4",
    "IS  - 2",
    "SP  - 10",
    "EP  - 20",
    "DO  - 10.5555/xyz",
    "UR  - https://exemple.org/r",
    "ER  - ",
    "",
    "TY  - BOOK",
    "TI  - Livre",
    "  sur deux lignes",
    "PB  - Éditions",
    "ER  -",
    "TY  - THES",
    "AU  - Sans, Titre",
    "ER  - ",
  ].join("\r\n");

  it("lit les entrées, les lignes de suite et les pages", () => {
    const result = parseReferences(RIS);
    expect(result.format).toBe("ris");
    expect(result.accepted.map((entry) => entry.reference)).toMatchObject([
      {
        sourceType: "article",
        authors: ["Diallo, Aminata", "Ba, Ousmane"],
        title: "Titre de l'article",
        containerTitle: "Revue",
        publicationYear: "2020",
        volume: "4",
        issue: "2",
        pages: "10-20",
        doi: "10.5555/xyz",
      },
      { sourceType: "book", title: "Livre sur deux lignes", publisher: "Éditions" },
    ]);
    expect(result.rejected).toEqual([{ index: 2, label: "", code: "missing_title" }]);
  });

  it("ignore les lignes hors entrée et une étiquette mal formée", () => {
    const result = parseReferences("TI  - orpheline\nTY  - GEN\nTI - mal formée\nTI  - Bon titre\nER  - \n");
    expect(result.accepted.map((entry) => entry.reference.title)).toEqual(["Bon titre"]);
  });
});

describe("budget d'expansion des macros (revue MOYEN-1)", () => {
  it("refuse un fichier dont les macros démultiplient le texte, en temps borné", () => {
    const macros = Array.from({ length: 100 }, (_, i) => `@string{m${i} = "${"x".repeat(2000)}"}`).join("\n");
    const field = Array.from({ length: 9 }, (_, i) => `m${i}`).join(" # ");
    const fields = Array.from({ length: 25 }, (_, i) => `f${i} = ${field}`).join(", ");
    const entries = Array.from({ length: 500 }, (_, i) => `@misc{k${i}, title = {T${i}}, ${fields}}`).join("\n");
    const text = `${macros}\n${entries}`;
    expect(text.length).toBeLessThan(IMPORT_MAX_BYTES);
    const started = Date.now();
    const result = parseReferences(text);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.tooLarge).toBe(true);
    expect(result.accepted).toEqual([]);
  });

  it("100 macros de 20 000 caractères et 500 citations : refusé, borné", () => {
    const text = `${Array.from({ length: 100 }, (_, i) => `@string{m${i} = "${"x".repeat(20000)}"}`).join("\n")}\n${Array.from({ length: 500 }, (_, i) => `@misc{k${i}, title = m${i % 100}}`).join("\n")}`;
    const started = Date.now();
    const result = parseReferences(text);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.tooLarge).toBe(true);
  });

  it("une macro de plus de 2 000 caractères n'est pas retenue", () => {
    const result = parseReferences(`@string{long = "${"y".repeat(2001)}"}\n@misc{a, title = {Titre} # long}`);
    expect(result.accepted[0]?.reference.title).toBe("Titre");
  });

  it("un champ démesuré est refusé, pas tronqué en silence", () => {
    const result = parseReferences(`@misc{a, title = {${"t".repeat(3000)}}}\n@misc{b, title = {Bon}, journal = {${"j".repeat(1300)}}}`);
    expect(result.rejected).toEqual([{ index: 0, label: "t".repeat(120), code: "invalid" }]);
    expect(result.accepted[0]?.dropped).toEqual(["containerTitle"]);
  });
});
