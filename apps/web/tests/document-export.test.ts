import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { BibliographySource } from "@/lib/projects/bibliography";
import {
  buildDocument,
  exportFileName,
  splitParagraphs,
  toMarkdown,
  type DocumentInput,
} from "@/lib/projects/document";
import { crc32, toDocx, xml, zip } from "@/lib/projects/docx";

function source(overrides: Partial<BibliographySource>): BibliographySource {
  return {
    id: "s",
    sourceType: "article",
    title: "Titre",
    authors: [],
    publicationYear: null,
    containerTitle: null,
    publisher: null,
    volume: null,
    issue: null,
    pages: null,
    doi: null,
    url: null,
    accessedOn: null,
    ...overrides,
  };
}

const input: DocumentInput = {
  title: "Détection d'intrusions <b>& co</b>",
  supervisorName: "Pr Ndiaye",
  sections: [
    { id: "a", level: 1, title: "Introduction", body: "Premier paragraphe.\nMême paragraphe.\n\n\nSecond paragraphe." },
    { id: "b", level: 2, title: "Contexte *important*", body: null },
    { id: "c", level: 1, title: "État de l'art", body: "# Pas un titre\n- pas une liste\n<script>alert(1)</script>" },
  ],
  citations: new Map([
    ["a", [
      { sourceId: "s2", pages: "p. 12" },
      { sourceId: "s1", pages: null },
      { sourceId: "disparue", pages: "p. 1" },
    ]],
  ]),
  sources: [
    source({ id: "s1", authors: ["Diop, Awa", "Sow, Ali"], publicationYear: 2021, title: "Graphes", containerTitle: "Revue de test", volume: "3" }),
    source({ id: "s2", sourceType: "book", authors: ["Mensah, Kofi"], publicationYear: 2019, title: "Manuel", publisher: "Presses" }),
  ],
};

/** Lit une archive ZIP produite par `zip` : nom de fichier → contenu. */
function unzip(archive: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressed = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const data = inflateRawSync(archive.subarray(start, start + compressed));
    expect(crc32(data), name).toBe(archive.readUInt32LE(offset + 14));
    expect(data.length, name).toBe(archive.readUInt32LE(offset + 22));
    files.set(name, data.toString("utf8"));
    offset = start + compressed;
  }
  return files;
}

describe("paragraphes", () => {
  it("sépare sur les lignes vides et garde les lignes d'un paragraphe", () => {
    expect(splitParagraphs("Un.\nDeux.\r\n\r\n  \nTrois.  \n\n")).toEqual([["Un.", "Deux."], ["Trois."]]);
    expect(splitParagraphs(null)).toEqual([]);
    expect(splitParagraphs("  \n\n ")).toEqual([]);
  });
});

describe("document d'un projet", () => {
  const document = buildDocument(input, "fr");

  it("numérote les sections et reprend le texte tel quel", () => {
    expect(document.sections.map((section) => `${section.number} ${section.title}`)).toEqual([
      "1 Introduction",
      "1.1 Contexte *important*",
      "2 État de l'art",
    ]);
    expect(document.sections[0]?.paragraphs).toEqual([
      ["Premier paragraphe.", "Même paragraphe."],
      ["Second paragraphe."],
    ]);
    expect(document.sections[1]?.paragraphs).toEqual([]);
  });

  it("liste les sources citées d'une section, sans celle qui n'existe plus", () => {
    expect(document.sections[0]?.citations).toEqual(["Diop, A. et al. (2021)", "Mensah, K. (2019), p. 12"]);
    expect(document.sections[2]?.citations).toEqual([]);
  });

  it("reprend la bibliographie du projet, toutes sources comprises", () => {
    expect(document.references.map((segments) => segments.map((segment) => segment.text).join(""))).toEqual([
      "Diop, A. et Sow, A. (2021). Graphes. Revue de test, 3.",
      "Mensah, K. (2019). Manuel. Presses.",
    ]);
  });

  it("suit la langue demandée", () => {
    const english = buildDocument(input, "en");
    expect(english.labels.references).toBe("References");
    expect(english.labels.supervisor).toBe("Supervised by");
    expect(english.references[0]?.map((segment) => segment.text).join("")).toContain("Diop, A. & Sow, A.");
  });
});

describe("nom du fichier exporté", () => {
  it("ne garde que des caractères sûrs", () => {
    expect(exportFileName("Détection d'intrusions : étude", "docx")).toBe(
      "memoire-Detection-d-intrusions-etude.docx",
    );
    expect(exportFileName('../../etc/passwd"\r\nX-Injected: 1', "md")).toBe(
      "memoire-etc-passwd-X-Injected-1.md",
    );
    expect(exportFileName("数据", "docx")).toBe("memoire.docx");
    expect(exportFileName("a".repeat(200), "md")).toHaveLength(71);
    // Un titre homonyme d'un nom réservé ne donne pas ce nom.
    expect(exportFileName("CON", "docx")).toBe("memoire-CON.docx");
    expect(exportFileName("NUL", "md")).toBe("memoire-NUL.md");
  });
});

describe("export Markdown", () => {
  const markdown = toMarkdown(buildDocument(input, "fr"));

  it("structure le document", () => {
    expect(markdown).toContain("## 1 Introduction\n");
    expect(markdown).toContain("### 1.1 Contexte \\*important\\*\n");
    expect(markdown).toContain("Premier paragraphe.  \nMême paragraphe.\n\nSecond paragraphe.\n");
    expect(markdown).toContain("Sous la direction de Pr Ndiaye");
    expect(markdown).toContain("## Références\n");
    expect(markdown).toContain("Diop, A. et Sow, A. (2021). Graphes. *Revue de test*, *3*.");
    expect(markdown).toContain("Sources citées dans cette section : Diop, A. et al. (2021) ; Mensah, K. (2019), p. 12");
  });

  it("neutralise ce qui changerait la mise en forme ou introduirait du HTML", () => {
    expect(markdown).toContain("# Détection d'intrusions \\<b\\>\\& co\\</b\\>");
    expect(markdown).toContain("\\# Pas un titre");
    expect(markdown).toContain("\\- pas une liste");
    expect(markdown).toContain("\\<script\\>alert(1)\\</script\\>");
    expect(markdown).not.toMatch(/^# Pas un titre/m);
    expect(markdown).not.toContain("<script>");
  });
});

describe("export Markdown : cas limites", () => {
  const render = (overrides: Partial<DocumentInput>) =>
    toMarkdown(buildDocument({ ...input, ...overrides }, "fr"));

  it("neutralise filets, puces, listes numérotées et soulignements de titre", () => {
    const markdown = render({
      sections: [
        { id: "x", level: 1, title: "T", body: "Texte\n---\n\n-\n\n+ puce\n\n1. liste\n\n===\n\n2) autre" },
      ],
      citations: new Map(),
    });
    for (const line of ["\\-\\-\\-", "\\-", "\\+ puce", "1\\. liste", "\\=\\=\\=", "2\\) autre"]) {
      expect(markdown, line).toContain(line);
    }
    expect(markdown).not.toMatch(/^---\s*$/m);
    expect(markdown).not.toMatch(/^1\. liste/m);
    expect(markdown).not.toMatch(/^\+ puce/m);
  });

  it("ne produit ni lien, ni image, ni entité, ni référence de lien", () => {
    const markdown = render({
      sections: [
        {
          id: "x",
          level: 1,
          title: "T",
          body: "[x](http://a.example) ![i](http://b.example) &copy; [r]: http://c.example <http://d.example>",
        },
      ],
      citations: new Map(),
    });
    expect(markdown).toContain("\\[x\\](http://a.example)");
    expect(markdown).toContain("!\\[i\\]");
    expect(markdown).toContain("\\&copy;");
    expect(markdown).toContain("\\[r\\]: http://c.example");
    expect(markdown).toContain("\\<http://d.example\\>");
  });

  it("garde exacts les DOI et adresses des références, et neutralise un début de liste", () => {
    const markdown = render({
      sections: [],
      citations: new Map(),
      sources: [
        source({
          id: "u",
          authors: ["1. Faux, Auteur"],
          publicationYear: 2020,
          title: "Titre",
          containerTitle: "Revue",
          doi: "10.5555/a_b~c*d",
        }),
        source({
          id: "v",
          sourceType: "web",
          authors: ["- Organisme"],
          publicationYear: 2021,
          title: "Page",
          url: "https://exemple.invalid/a_b?x=1&y=2#z",
        }),
      ],
    });
    expect(markdown).toContain("<https://doi.org/10.5555/a_b~c*d>");
    expect(markdown).toContain("<https://exemple.invalid/a_b?x=1&y=2#z>");
    expect(markdown).toMatch(/^1\\\. Faux, A\./m);
    expect(markdown).toMatch(/^\\- Organisme\./m);
  });
});

describe("export DOCX", async () => {
  const archive = await toDocx(buildDocument(input, "fr"));
  const files = unzip(archive);

  it("est une archive ZIP aux fichiers attendus, aux sommes de contrôle justes", () => {
    expect(archive.subarray(0, 2).toString("latin1")).toBe("PK");
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/_rels/document.xml.rels",
    ]);
    // Fin d'archive : cinq entrées annoncées.
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    expect(archive.readUInt16LE(archive.length - 12)).toBe(5);
  });

  it("contient le titre, les titres de sections, le texte et les références", () => {
    const body = files.get("word/document.xml") ?? "";
    expect(body).toContain('<w:pStyle w:val="Title"/>');
    expect(body).toContain('<w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">1.1 Contexte *important*</w:t>');
    expect(body).toContain("Premier paragraphe.</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space=\"preserve\">Même paragraphe.");
    expect(body).toContain('<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Revue de test</w:t>');
    expect(body).toContain("Sous la direction de Pr Ndiaye");
    expect(files.get("word/styles.xml")).toContain('w:lang w:val="fr-FR"');
  });

  it("échappe le texte de l'utilisateur : aucune balise ne passe", () => {
    const body = files.get("word/document.xml") ?? "";
    expect(body).toContain("Détection d'intrusions &lt;b&gt;&amp; co&lt;/b&gt;");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<b>");
    // Le document reste bien formé : autant de balises ouvrantes que fermantes.
    for (const tag of ["w:p", "w:r", "w:t"]) {
      const opened = (body.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
      const closed = (body.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      expect(opened, tag).toBe(closed);
    }
  });

  it("retire les caractères que XML n'admet pas", () => {
    expect(xml("a\u0000b\u0008c￾d\u000Be")).toBe("abcde");
    expect(xml('<"&">')).toBe("&lt;&quot;&amp;&quot;&gt;");
    expect(xml("Ligne\nsuivante\tici 😀")).toBe("Ligne\nsuivante\tici 😀");
  });

  it("produit le même fichier pour le même contenu", async () => {
    expect((await toDocx(buildDocument(input, "fr"))).equals(archive)).toBe(true);
  });

  it("calcule la somme de contrôle de référence", async () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect((await zip([])).length).toBe(22);
  });

  it("ne laisse aucune charge sortir du texte : ni champ, ni balise, ni entité", async () => {
    const hostile =
      '"/><w:fldSimple w:instr="INCLUDETEXT secret"/> ]]> &#x0; <!ENTITY x SYSTEM "file:///etc/passwd">';
    const body =
      unzip(
        await toDocx(
          buildDocument(
            {
              ...input,
              title: hostile,
              supervisorName: hostile,
              sections: [{ id: "x", level: 1, title: hostile, body: hostile }],
            },
            "fr",
          ),
        ),
      ).get("word/document.xml") ?? "";
    expect(body).not.toContain("<w:fldSimple");
    expect(body).not.toContain("<!ENTITY");
    expect(body).toContain("&quot;/&gt;&lt;w:fldSimple");
    expect(body).toContain("&amp;#x0;");
    // Seules les balises écrites par le module sont présentes.
    const tags = new Set((body.match(/<\/?[a-zA-Z:]+/g) ?? []).map((tag) => tag.replace(/[</]/g, "")));
    expect([...tags].sort()).toEqual(
      ["w:body", "w:document", "w:i", "w:p", "w:pPr", "w:pStyle", "w:pgMar", "w:pgSz", "w:r", "w:rPr", "w:sectPr", "w:t"].sort(),
    );
  });
});
