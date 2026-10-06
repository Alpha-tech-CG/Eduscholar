import { describe, expect, it } from "vitest";
import {
  citationSchema,
  countWords,
  newSectionSchema,
  numberSections,
  sectionSchema,
} from "@/lib/projects/section-schemas";

describe("numérotation du plan", () => {
  it("numérote chapitres, sections et sous-sections dans l'ordre du document", () => {
    expect(numberSections([1, 2, 2, 3, 3, 1, 2, 1])).toEqual([
      "1", "1.1", "1.2", "1.2.1", "1.2.2", "2", "2.1", "3",
    ]);
  });

  it("repart de un sous chaque nouveau titre de niveau supérieur", () => {
    expect(numberSections([1, 2, 3, 2, 3, 1, 3])).toEqual(["1", "1.1", "1.1.1", "1.2", "1.2.1", "2", "2.1.1"]);
  });

  it("décrit un plan qui commence par une section, sans le corriger", () => {
    expect(numberSections([2, 3, 1])).toEqual(["1.1", "1.1.1", "1"]);
  });

  it("ramène un niveau invalide dans les bornes", () => {
    expect(numberSections([0, 9, Number.NaN])).toEqual(["1", "1.1.1", "2"]);
    expect(numberSections([])).toEqual([]);
  });
});

describe("nombre de mots", () => {
  it("compte les mots, apostrophes et traits d'union compris", () => {
    expect(countWords("L'état de l’art : pare-feu et 3 réseaux.")).toBe(7);
    expect(countWords("  Un\n\ndeux\ttrois  ")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords("— … !")).toBe(0);
  });
});

describe("section", () => {
  it("exige un titre et un niveau de un à trois", () => {
    expect(newSectionSchema.safeParse({ title: " Introduction ", level: "1" }).success).toBe(true);
    for (const value of [
      { title: "", level: "1" },
      { title: "Titre", level: "4" },
      { title: "Titre", level: "" },
      { title: "a".repeat(301), level: "1" },
    ]) {
      expect(newSectionSchema.safeParse(value).success, JSON.stringify(value).slice(0, 40)).toBe(false);
    }
  });

  it("garde le texte tel quel, espaces et sauts de ligne compris", () => {
    const body = "  Premier paragraphe.\n\n  Second paragraphe.  ";
    expect(sectionSchema.parse({ title: "Titre", level: "2", body }).body).toBe(body);
    expect(sectionSchema.parse({ title: "Titre", level: "2", body: "   " }).body).toBeUndefined();
  });

  it("borne le texte à trente mille caractères", () => {
    expect(sectionSchema.safeParse({ title: "T", level: "1", body: "a".repeat(30000) }).success).toBe(true);
    expect(sectionSchema.safeParse({ title: "T", level: "1", body: "a".repeat(30001) }).success).toBe(false);
  });
});

describe("citation", () => {
  it("exige l'identifiant d'une source ; les pages sont facultatives", () => {
    const sourceId = "00000000-0000-4000-8000-000000000001";
    expect(citationSchema.parse({ sourceId, pages: " p. 12 " })).toEqual({ sourceId, pages: "p. 12" });
    expect(citationSchema.parse({ sourceId, pages: "" }).pages).toBeUndefined();
    expect(citationSchema.safeParse({ sourceId: "", pages: "" }).success).toBe(false);
    expect(citationSchema.safeParse({ sourceId: "' or 1=1", pages: "" }).success).toBe(false);
    expect(citationSchema.safeParse({ sourceId, pages: "p".repeat(51) }).success).toBe(false);
  });
});
