import { describe, expect, it } from "vitest";
import {
  buildBibliography,
  formatAuthor,
  formatReference,
  referenceText,
  type BibliographySource,
} from "@/lib/projects/bibliography";

function source(overrides: Partial<BibliographySource>): BibliographySource {
  return {
    id: overrides.id ?? "s",
    sourceType: "article",
    title: "Titre de test",
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

const text = (value: Partial<BibliographySource>, locale: "fr" | "en" = "fr") =>
  referenceText(formatReference(source(value), locale));

describe("nom d'un auteur", () => {
  it("abrège les prénoms d'un nom saisi « Nom, Prénom »", () => {
    expect(formatAuthor("Diop, Awa")).toEqual({ text: "Diop, A.", inverted: true });
    expect(formatAuthor("Martin, Jean-Pierre Louis")).toEqual({ text: "Martin, J.-P. L.", inverted: true });
    expect(formatAuthor("  de La Fontaine ,  jean ")).toEqual({ text: "de La Fontaine, J.", inverted: true });
    expect(formatAuthor("Élise, émile")).toEqual({ text: "Élise, É.", inverted: true });
  });

  it("reprend tel quel un nom sans virgule : rien ne dit où finit le prénom", () => {
    for (const name of ["Awa Diop", "Organisation mondiale de la santé", "Mao Zedong", "Diop,", ", Awa"]) {
      expect(formatAuthor(name)).toEqual({ text: name, inverted: false });
    }
  });
});

describe("référence au format APA", () => {
  it("article de revue", () => {
    const reference = formatReference(
      source({
        authors: ["Martin, Yann", "Diop, Awa"],
        publicationYear: 2020,
        title: "Apprentissage profond pour la détection",
        containerTitle: "Revue de test",
        volume: "12",
        issue: "3",
        pages: "45-67",
        doi: "10.5555/abc",
        url: "https://exemple.invalid/ignore",
      }),
      "fr",
    );
    expect(referenceText(reference)).toBe(
      "Martin, Y. et Diop, A. (2020). Apprentissage profond pour la détection. Revue de test, 12(3), 45-67. https://doi.org/10.5555/abc",
    );
    // La revue et le volume sont en italique, pas le titre de l'article.
    expect(reference.segments.filter((segment) => segment.italic).map((segment) => segment.text)).toEqual([
      "Revue de test",
      "12",
    ]);
    expect(reference.issues).toEqual([]);
  });

  it("livre, en anglais, à trois auteurs", () => {
    const reference = formatReference(
      source({
        sourceType: "book",
        authors: ["Knuth, Donald", "Lovelace, Ada", "Turing, Alan"],
        publicationYear: 1997,
        title: "The art of testing",
        publisher: "Test Press",
      }),
      "en",
    );
    expect(referenceText(reference)).toBe(
      "Knuth, D., Lovelace, A., & Turing, A. (1997). The art of testing. Test Press.",
    );
    expect(reference.segments.find((segment) => segment.italic)?.text).toBe("The art of testing");
  });

  it("chapitre d'ouvrage", () => {
    expect(
      text({
        sourceType: "chapter",
        authors: ["Diop, Awa"],
        publicationYear: 2019,
        title: "Les arbres équilibrés",
        containerTitle: "Manuel d'algorithmique",
        pages: "101-130",
        publisher: "Éditions de test",
      }),
    ).toBe(
      "Diop, A. (2019). Les arbres équilibrés. Dans Manuel d'algorithmique (p. 101-130). Éditions de test.",
    );
  });

  it("thèse", () => {
    expect(
      text({
        sourceType: "thesis",
        authors: ["Mensah, Kofi"],
        publicationYear: 2022,
        title: "Détection d'intrusions",
        publisher: "Université de test",
        url: "https://exemple.invalid/these",
      }),
    ).toBe(
      "Mensah, K. (2022). Détection d'intrusions [Thèse ou mémoire, Université de test]. https://exemple.invalid/these",
    );
  });

  it("page web, avec date de consultation", () => {
    expect(
      text({
        sourceType: "web",
        authors: ["Agence de test"],
        publicationYear: 2025,
        title: "Guide de sécurité",
        containerTitle: "Site de l'agence",
        url: "https://exemple.invalid/guide",
        accessedOn: "2026-09-01",
      }),
    ).toBe(
      "Agence de test. (2025). Guide de sécurité. Site de l'agence. Consulté le 1er septembre 2026, à l'adresse https://exemple.invalid/guide",
    );
    expect(
      text(
        {
          sourceType: "web",
          authors: ["Test Agency"],
          title: "Security guide",
          url: "https://exemple.invalid/guide",
          accessedOn: "2026-09-30",
        },
        "en",
      ),
    ).toBe(
      "Test Agency. (n.d.). Security guide. Retrieved September 30, 2026, from https://exemple.invalid/guide",
    );
  });

  it("sans auteur, le titre prend sa place", () => {
    expect(text({ sourceType: "report", title: "Rapport annuel", publicationYear: 2021, publisher: "Organisme" })).toBe(
      "Rapport annuel. (2021). Organisme.",
    );
  });

  it("ne double pas la ponctuation finale", () => {
    expect(text({ authors: ["Diop, Awa"], publicationYear: 2020, title: "Que faire ?", containerTitle: "Revue" })).toBe(
      "Diop, A. (2020). Que faire ? Revue.",
    );
    expect(
      text({ sourceType: "book", authors: ["Diop, Awa"], publicationYear: 2020, title: "Que faire ?", publisher: "Presses" }),
    ).toBe("Diop, A. (2020). Que faire ? Presses.");
    expect(text({ sourceType: "book", authors: ["Diop, Awa"], publicationYear: 2020, title: "Titre saisi avec un point." })).toBe(
      "Diop, A. (2020). Titre saisi avec un point.",
    );
    expect(text({ sourceType: "report", title: "Où va-t-on ?", publicationYear: 2021 })).toBe("Où va-t-on ? (2021).");
  });

  it("au-delà de vingt auteurs : dix-neuf, des points de suspension, le dernier", () => {
    const authors = Array.from({ length: 22 }, (_, index) => `Nom${index + 1}, A`);
    const result = text({ authors, publicationYear: 2020, containerTitle: "Revue" });
    expect(result).toContain("Nom19, A., … Nom22, A.");
    expect(result).not.toContain("Nom20");
  });

  it("n'écrit jamais une adresse qui n'est pas http ou https", () => {
    expect(text({ sourceType: "web", title: "Page", url: "javascript:alert(1)" })).not.toContain("javascript");
  });
});

describe("rien n'est inventé", () => {
  it("un champ absent n'est jamais remplacé par une valeur supposée", () => {
    const reference = formatReference(source({ title: "Seul le titre" }), "fr");
    expect(referenceText(reference)).toBe("Seul le titre. (s. d.).");
    expect(reference.issues).toEqual(["missing_authors", "missing_year", "missing_container"]);
  });

  it("la référence ne contient que des éléments de la source", () => {
    const value = source({
      sourceType: "book",
      authors: ["Awa Diop"],
      publicationYear: 2018,
      title: "Introduction aux graphes",
      publisher: "Presses de test",
    });
    const reference = formatReference(value, "fr");
    expect(referenceText(reference)).toBe("Awa Diop. (2018). Introduction aux graphes. Presses de test.");
    // Le nom n'a pas été inversé d'office : il est signalé, pas deviné.
    expect(reference.issues).toEqual(["author_not_inverted"]);
  });

  it("signale ce qui manque selon le type", () => {
    const issues = (value: Partial<BibliographySource>) => formatReference(source(value), "fr").issues;
    expect(issues({ sourceType: "book", authors: ["Diop, Awa"], publicationYear: 2020 })).toEqual(["missing_publisher"]);
    expect(
      issues({ sourceType: "chapter", authors: ["Diop, Awa"], publicationYear: 2020, containerTitle: "Ouvrage" }),
    ).toEqual(["missing_pages"]);
    expect(issues({ sourceType: "web", authors: ["Diop, Awa"], publicationYear: 2020 })).toEqual(["missing_locator"]);
    expect(issues({ sourceType: "other", authors: ["Diop, Awa"], publicationYear: 2020 })).toEqual([]);
  });
});

describe("bibliographie d'un projet", () => {
  const sources = [
    source({ id: "c", authors: ["Mensah, Kofi"], publicationYear: 2021, title: "Zèbres", containerTitle: "Revue" }),
    source({ id: "a", authors: ["Diop, Awa"], publicationYear: 2022, title: "Graphes", containerTitle: "Revue" }),
    source({ id: "b", authors: ["Diop, Awa"], publicationYear: 2019, title: "Arbres", containerTitle: "Revue" }),
    source({ id: "d", sourceType: "report", title: "élections et réseaux", publicationYear: 2020, publisher: "Organisme" }),
  ];

  it("contient chaque source une fois, et rien d'autre", () => {
    const { references } = buildBibliography(sources, "fr");
    expect(references.map((reference) => reference.sourceId).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("classe par auteur, puis par année ; une source sans auteur se classe à son titre", () => {
    const { references } = buildBibliography(sources, "fr");
    expect(references.map((reference) => reference.sourceId)).toEqual(["b", "a", "d", "c"]);
  });

  it("signale les doublons par DOI, ou par titre et année", () => {
    const { references, flagged } = buildBibliography(
      [
        source({ id: "1", authors: ["Diop, Awa"], publicationYear: 2020, title: "Même DOI", containerTitle: "R", doi: "10.5555/x" }),
        source({ id: "2", authors: ["Diop, Awa"], publicationYear: 2021, title: "Autre titre", containerTitle: "R", doi: "10.5555/X" }),
        source({ id: "3", authors: ["Sow, Ali"], publicationYear: 2019, title: "Sécurité des réseaux", containerTitle: "R" }),
        source({ id: "4", authors: ["Sow, Ali"], publicationYear: 2019, title: "securite  des RÉSEAUX.", containerTitle: "R" }),
        source({ id: "5", authors: ["Sow, Ali"], publicationYear: 2018, title: "Sécurité des réseaux", containerTitle: "R" }),
      ],
      "fr",
    );
    const duplicates = references.filter((reference) => reference.issues.includes("duplicate"));
    expect(duplicates.map((reference) => reference.sourceId).sort()).toEqual(["1", "2", "3", "4"]);
    expect(flagged).toBe(4);
  });

  it("rend une bibliographie vide pour un projet sans source", () => {
    expect(buildBibliography([], "en")).toEqual({ references: [], flagged: 0 });
  });
});
