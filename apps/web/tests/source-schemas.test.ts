import { describe, expect, it } from "vitest";
import {
  noteSchema,
  readSourceForm,
  sourceFieldErrors,
  sourceSchema,
  toNotePayload,
  toSourcePayload,
} from "@/lib/projects/source-schemas";

const form = (values: Record<string, string>) => readSourceForm((name) => values[name] ?? "");

describe("source bibliographique", () => {
  it("lit un formulaire complet et prépare la charge utile", () => {
    const parsed = sourceSchema.parse(
      form({
        sourceType: "article",
        title: "  Apprentissage profond  ",
        authors: "Yann Martin\n\n Awa  Diop \nYann Martin",
        publicationYear: "2020",
        containerTitle: "Revue de test",
        volume: "12",
        pages: "45-67",
        doi: "https://doi.org/10.5555/abc",
        url: "https://exemple.invalid/a",
        accessedOn: "2026-09-30",
      }),
    );
    expect(toSourcePayload(parsed)).toEqual({
      source_type: "article",
      title: "Apprentissage profond",
      authors: ["Yann Martin", "Awa Diop"],
      publication_year: "2020",
      container_title: "Revue de test",
      publisher: "",
      volume: "12",
      issue: "",
      pages: "45-67",
      doi: "10.5555/abc",
      url: "https://exemple.invalid/a",
      accessed_on: "2026-09-30",
    });
  });

  it("n'exige que le type et le titre", () => {
    expect(sourceSchema.safeParse(form({ sourceType: "book", title: "Un livre" })).success).toBe(true);
  });

  it("signale chaque champ fautif par un code", () => {
    const result = sourceSchema.safeParse(
      form({
        sourceType: "tweet",
        title: "",
        publicationYear: "20",
        doi: "pas-un-doi",
        url: "javascript:alert(1)",
        accessedOn: "30/09/2026",
        volume: "v".repeat(51),
      }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(sourceFieldErrors(result.error)).toEqual({
      sourceType: "invalid_choice",
      title: "required",
      publicationYear: "invalid_year",
      doi: "invalid_doi",
      url: "invalid_url",
      accessedOn: "invalid_date",
      volume: "too_long",
    });
  });

  it("refuse les adresses dangereuses ou trompeuses", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://exemple.invalid/a",
      "https://vrai.example@autre.example/",
      "https://exemple.invalid/a b",
      "//exemple.invalid",
    ]) {
      expect(sourceSchema.safeParse(form({ sourceType: "web", title: "Page", url })).success, url).toBe(
        false,
      );
    }
  });

  it("borne l'année et la date de consultation", () => {
    for (const publicationYear of ["1399", "2101", "abcd", "20201"]) {
      expect(
        sourceSchema.safeParse(form({ sourceType: "book", title: "Livre", publicationYear })).success,
        publicationYear,
      ).toBe(false);
    }
    for (const accessedOn of ["1989-12-31", "2101-01-01", "2026-02-30", "infinity"]) {
      expect(
        sourceSchema.safeParse(form({ sourceType: "web", title: "Page", accessedOn })).success,
        accessedOn,
      ).toBe(false);
    }
  });
});

describe("fiche de lecture", () => {
  it("accepte une fiche vide et ne transmet que ses champs", () => {
    const payload = toNotePayload(noteSchema.parse({ problem: " Sujet ", sourceId: "x", extra: "y" }));
    expect(payload).toEqual({
      problem: "Sujet",
      concepts: "",
      method: "",
      population_field: "",
      results: "",
      limits: "",
      useful_quote: "",
      quote_pages: "",
      project_link: "",
      target_chapter: "",
    });
  });

  it("borne chaque champ", () => {
    expect(noteSchema.safeParse({ results: "a".repeat(3001) }).success).toBe(false);
    expect(noteSchema.safeParse({ usefulQuote: "a".repeat(2001) }).success).toBe(false);
    expect(noteSchema.safeParse({ quotePages: "p".repeat(51) }).success).toBe(false);
    expect(noteSchema.safeParse({ results: "a".repeat(3000) }).success).toBe(true);
  });
});
