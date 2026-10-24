import { describe, expect, it } from "vitest";
import {
  DEGREES_BY_TYPE,
  degreeForType,
  resourceFieldErrors,
  resourceSchema,
  toResourcePayload,
} from "@/lib/catalogue/schemas";

const valid = {
  typeCode: "article",
  title: "Introduction aux arbres équilibrés",
  abstract: "",
  authors: ["Awa Diop"],
  institutionName: "",
  publicationYear: "2024",
  thesisDegree: "",
  languageCode: "fr",
  countryCode: "SN",
  programCode: "computer_science",
  levelCodes: ["bachelor_3"],
  subjectCodes: ["algorithms"],
  tags: ["arbres"],
  doi: "",
  officialUrl: "https://exemple.invalid/article",
  accessStatus: "open_access",
  licenseCode: "cc-by-4.0",
  contributorComment: "",
  permissionProof: "",
  rightsDeclared: true,
};

describe("thèse et mémoire", () => {
  it("une thèse prépare un doctorat, un mémoire une licence ou un master", () => {
    expect(DEGREES_BY_TYPE).toEqual({ thesis: ["doctorate"], memoir: ["bachelor", "master"] });
  });

  it.each([
    ["thesis", "doctorate"],
    ["memoir", "master"],
    ["memoir", "bachelor"],
    ["thesis", ""],
    ["memoir", ""],
  ])("accepte le type %s avec le diplôme « %s »", (typeCode, thesisDegree) => {
    const parsed = resourceSchema.parse({ ...valid, typeCode, thesisDegree });
    expect(toResourcePayload(parsed).thesis_degree).toBe(thesisDegree);
  });

  it.each([
    ["thesis", "master"],
    ["thesis", "bachelor"],
    ["memoir", "doctorate"],
  ])("refuse le type %s avec le diplôme %s", (typeCode, thesisDegree) => {
    const result = resourceSchema.safeParse({ ...valid, typeCode, thesisDegree });
    expect(result.success).toBe(false);
    if (!result.success) expect(resourceFieldErrors(result.error).thesisDegree).toBe("invalid_choice");
  });

  it.each(["article", "chapter", "report", "preprint", "past_exam", "technical_documentation", "dataset", "presentation"])(
    "n'envoie aucun diplôme pour le type %s",
    (typeCode) => {
      const parsed = resourceSchema.parse({ ...valid, typeCode, thesisDegree: "master" });
      expect(toResourcePayload(parsed).thesis_degree).toBe("");
    },
  );

  it("ne prend pas une propriété héritée pour un type", () => {
    expect(degreeForType("constructor", "master")).toBe("");
    expect(degreeForType("__proto__", "master")).toBe("");
  });
});
