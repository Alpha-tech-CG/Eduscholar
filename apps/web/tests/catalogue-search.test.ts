import { describe, expect, it } from "vitest";
import {
  parseSearchParams,
  searchTerms,
  toSearchParams,
  toTsQuery,
} from "@/lib/catalogue/search";

const reference = {
  types: ["article", "book"],
  languages: ["fr", "en"],
  levels: ["bachelor_3"],
  subjects: ["algorithms"],
};

describe("mots cherchés", () => {
  it("retire les accents, la casse et la ponctuation", () => {
    expect(searchTerms("  Sécurité des RÉSEAUX, cœur & noyau ")).toEqual([
      "securite",
      "des",
      "reseaux",
      "coeur",
      "noyau",
    ]);
  });

  it("borne le nombre et la longueur des mots, sans doublon", () => {
    const terms = searchTerms(`${"a".repeat(80)} b b c d e f g h i j`);
    expect(terms).toHaveLength(8);
    expect(terms[0]).toHaveLength(40);
    expect(terms.filter((term) => term === "b")).toHaveLength(1);
  });

  it("garde les écritures non latines", () => {
    expect(searchTerms("شبكات 网络")).toEqual(["شبكات", "网络"]);
  });
});

describe("requête plein texte", () => {
  it("cherche chaque mot par son début", () => {
    expect(toTsQuery("arbre équilibré")).toBe("arbre:* & equilibre:*");
  });

  it("ne laisse passer aucun opérateur", () => {
    for (const hostile of [
      "a | b",
      "!a",
      "a <-> b",
      "a:*) | (b",
      "'a' & \\",
      "a); drop table resources;--",
      "a&b|c!d(e)f:g*h'i\"j\\k",
    ]) {
      expect(toTsQuery(hostile) ?? "", hostile).toMatch(/^[\p{L}\p{N}]+:\*( & [\p{L}\p{N}]+:\*)*$/u);
    }
  });

  it("rend null quand il n'y a rien à chercher", () => {
    for (const empty of ["", "   ", "!!! ??? &&&", "''"]) {
      expect(toTsQuery(empty)).toBeNull();
    }
  });
});

describe("paramètres de l'adresse", () => {
  it("ne retient que les valeurs du référentiel", () => {
    expect(
      parseSearchParams(
        {
          q: "  arbres   équilibrés ",
          type: "article",
          language: "xx",
          access: "open_access",
          level: "bachelor_3",
          subject: "' or 1=1 --",
          page: "3",
        },
        reference,
      ),
    ).toEqual({
      query: "arbres équilibrés",
      typeCode: "article",
      languageCode: null,
      accessStatus: "open_access",
      levelCode: "bachelor_3",
      subjectCode: null,
      page: 3,
    });
  });

  it("n'offre pas de filtrer sur les fiches retirées ou au statut inconnu", () => {
    for (const access of ["removed", "unknown", "constructor"]) {
      expect(parseSearchParams({ access }, reference).accessStatus).toBeNull();
    }
  });

  it("ramène une page invalide à une valeur sûre", () => {
    for (const [page, expected] of [
      ["0", 1],
      ["-4", 1],
      ["abc", 1],
      ["2.5", 2],
      ["999999999", 250],
      [undefined, 1],
    ] as const) {
      expect(parseSearchParams({ page }, reference).page, String(page)).toBe(expected);
    }
  });

  it("prend la première valeur d'un paramètre répété et borne la requête", () => {
    const filters = parseSearchParams({ q: ["x".repeat(500), "autre"], type: ["book", "article"] }, reference);
    expect(filters.query).toHaveLength(200);
    expect(filters.typeCode).toBe("book");
  });

  it("reconstruit l'adresse d'une page de résultats", () => {
    const filters = parseSearchParams({ q: "arbres", type: "article", page: "2" }, reference);
    expect(toSearchParams(filters, 3)).toEqual({ q: "arbres", type: "article", page: "3" });
    expect(toSearchParams(filters, 1)).toEqual({ q: "arbres", type: "article" });
  });
});
