import { describe, expect, it } from "vitest";
import { normalizeCrossrefWork, parseDoi } from "@/lib/connectors/crossref-normalize";

// Réponses construites pour les tests, à la forme de l'API Crossref. Les DOI
// utilisent le préfixe 10.5555, réservé par Crossref aux exemples.
function response(message: Record<string, unknown>) {
  return { status: "ok", "message-type": "work", message };
}

const article = {
  DOI: "10.5555/EXEMPLE.2024.001",
  type: "journal-article",
  title: ["Un <i>exemple</i>‮ d'article\n de test"],
  author: [
    { given: "Awa", family: "Diop" },
    { name: "Collectif de test" },
    { given: "  ", family: "" },
  ],
  issued: { "date-parts": [[2024, 3, 12]] },
  language: "fr",
  license: [
    { URL: "https://creativecommons.org/licenses/by/4.0/", "content-version": "vor" },
    { URL: "https://exemple.invalid/tdm", "content-version": "tdm" },
  ],
  abstract: "<jats:p>Résumé qui ne doit pas être repris.</jats:p>",
};

describe("lecture d'un DOI saisi", () => {
  it("accepte un DOI nu, préfixé ou sous forme de lien", () => {
    expect(parseDoi("10.5555/Exemple.2024.001")).toBe("10.5555/exemple.2024.001");
    expect(parseDoi(" doi:10.5555/abc ")).toBe("10.5555/abc");
    expect(parseDoi("https://doi.org/10.5555/abc")).toBe("10.5555/abc");
    expect(parseDoi("http://dx.doi.org/10.5555/abc")).toBe("10.5555/abc");
  });

  it("refuse ce qui n'est pas un DOI", () => {
    for (const value of [
      "",
      "abc",
      "10.5555",
      "10.5555/",
      "10.55/abc",
      "10.5555/a b",
      "https://evil.example/10.5555/abc",
      "../../admin",
      "10.5555/abc\u202Edef",
      "10.5555/abc\uD800",
      `10.5555/${"a".repeat(300)}`,
    ]) {
      expect(parseDoi(value), value).toBeNull();
    }
  });
});

describe("normalisation d'une réponse Crossref", () => {
  it("reprend les métadonnées, sans rien déduire", () => {
    const result = normalizeCrossrefWork(response(article), "10.5555/exemple.2024.001");
    expect(result).toEqual({
      ok: true,
      work: {
        doi: "10.5555/exemple.2024.001",
        typeCode: "article",
        title: "Un exemple d'article de test",
        authors: ["Awa Diop", "Collectif de test"],
        publicationYear: 2024,
        languageCode: "fr",
        licenseCode: "cc-by-4.0",
        officialUrl: "https://doi.org/10.5555/exemple.2024.001",
      },
    });
    // Le résumé n'est jamais repris.
    expect(JSON.stringify(result)).not.toContain("Résumé");
  });

  it("laisse vides les champs absents", () => {
    const result = normalizeCrossrefWork(
      response({ DOI: "10.5555/abc", type: "book", title: ["Titre seul"] }),
      "10.5555/abc",
    );
    expect(result).toMatchObject({
      ok: true,
      work: {
        typeCode: "book",
        authors: [],
        publicationYear: null,
        languageCode: null,
        licenseCode: "unknown",
      },
    });
  });

  it("ne retient une licence que si elle est reconnue et sans ambiguïté", () => {
    const license = (entries: unknown[]) => {
      const result = normalizeCrossrefWork(
        response({ ...article, license: entries }),
        "10.5555/exemple.2024.001",
      );
      return result.ok ? result.work.licenseCode : null;
    };

    expect(
      license([
        {
          URL: "http://creativecommons.org/licenses/by-nc-nd/4.0/legalcode",
          "content-version": "vor",
        },
      ]),
    ).toBe("cc-by-nc-nd-4.0");
    // Version non précisée : rien de sûr sur le document diffusé.
    expect(license([{ URL: "https://creativecommons.org/licenses/by/4.0/" }])).toBe("unknown");
    // Licence sous embargo, ou à la date illisible.
    for (const start of ["2999-01-01T00:00:00Z", "bientôt"]) {
      expect(
        license([
          {
            URL: "https://creativecommons.org/licenses/by/4.0/",
            "content-version": "vor",
            start: { "date-time": start },
          },
        ]),
      ).toBe("unknown");
    }
    expect(
      license([
        {
          URL: "https://creativecommons.org/licenses/by/4.0/",
          "content-version": "vor",
          start: { "date-time": "2020-01-01T00:00:00Z" },
        },
      ]),
    ).toBe("cc-by-4.0");
    // Licence d'éditeur : inconnue du référentiel.
    expect(license([{ URL: "https://exemple.invalid/licence", "content-version": "vor" }])).toBe(
      "unknown",
    );
    // Version ancienne de la licence : pas d'assimilation à la 4.0.
    expect(
      license([{ URL: "https://creativecommons.org/licenses/by/3.0/", "content-version": "vor" }]),
    ).toBe("unknown");
    // Licence du manuscrit accepté seulement : elle ne dit rien de la version publiée.
    expect(
      license([{ URL: "https://creativecommons.org/licenses/by/4.0/", "content-version": "am" }]),
    ).toBe("unknown");
    // Deux licences différentes pour la version publiée.
    expect(
      license([
        { URL: "https://creativecommons.org/licenses/by/4.0/", "content-version": "vor" },
        { URL: "https://creativecommons.org/licenses/by-nc/4.0/", "content-version": "vor" },
      ]),
    ).toBe("unknown");
    // Un domaine qui imite celui de Creative Commons.
    expect(
      license([
        {
          URL: "https://creativecommons.org.evil.example/licenses/by/4.0/",
          "content-version": "vor",
        },
      ]),
    ).toBe("unknown");
  });

  it("refuse une réponse qui décrit un autre DOI", () => {
    expect(normalizeCrossrefWork(response(article), "10.5555/autre")).toEqual({
      ok: false,
      reason: "doi_mismatch",
    });
  });

  it("refuse un type que le catalogue ne prend pas en charge", () => {
    for (const type of ["dataset", "posted-content", "component", "constructor", "__proto__", undefined]) {
      expect(
        normalizeCrossrefWork(response({ ...article, type }), "10.5555/exemple.2024.001"),
      ).toEqual({ ok: false, reason: "unsupported_type" });
    }
  });

  it("refuse une réponse sans titre ou mal formée", () => {
    expect(
      normalizeCrossrefWork(response({ ...article, title: ["<b></b>"] }), "10.5555/exemple.2024.001"),
    ).toEqual({ ok: false, reason: "no_title" });
    for (const body of [null, "texte", {}, { status: "error" }, { status: "ok", message: [] }]) {
      expect(normalizeCrossrefWork(body, "10.5555/abc")).toEqual({
        ok: false,
        reason: "invalid_response",
      });
    }
  });

  it("écarte une année invraisemblable et borne les listes", () => {
    const result = normalizeCrossrefWork(
      response({
        ...article,
        issued: { "date-parts": [[99999]] },
        author: Array.from({ length: 80 }, (_, index) => ({ family: `Auteur ${index}` })),
        language: "zz-inconnu",
      }),
      "10.5555/exemple.2024.001",
    );
    expect(result.ok && result.work.publicationYear).toBeNull();
    expect(result.ok && result.work.authors.length).toBe(50);
    expect(result.ok && result.work.languageCode).toBe("zz");
  });
});

describe("robustesse face à une réponse inhabituelle", () => {
  const doi = "10.5555/exemple.2024.001";

  it("ne garde qu'une fois deux auteurs strictement homonymes", () => {
    const result = normalizeCrossrefWork(
      response({ ...article, author: [{ family: "Diop" }, { family: "Diop" }, { family: "Sow" }] }),
      doi,
    );
    expect(result.ok && result.work.authors).toEqual(["Diop", "Sow"]);
  });

  it("ne coupe jamais un caractère en deux", () => {
    const result = normalizeCrossrefWork(
      response({ ...article, title: [`${"a".repeat(499)}😀😀`] }),
      doi,
    );
    expect(result.ok && result.work.title).toBe(`${"a".repeat(499)}😀`);
  });

  it("encode le DOI dans le lien officiel", () => {
    const special = '10.5555/a<b>"c#d?e';
    const result = normalizeCrossrefWork(response({ ...article, DOI: special }), special);
    expect(result.ok && result.work.officialUrl).toBe(
      "https://doi.org/10.5555/a%3Cb%3E%22c%23d%3Fe",
    );
  });
});
