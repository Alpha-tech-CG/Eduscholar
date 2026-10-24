import { describe, expect, it } from "vitest";
import {
  isCleanShortText,
  normalizeShortText,
  privacySchema,
  profileFieldErrors,
  profileSchema,
} from "@/lib/profile/schemas";

const valid = {
  countryCode: "SN",
  levelCode: "bachelor_3",
  programCode: "computer_science",
  specialtyCode: "data_ai",
  subjectCodes: ["algorithms", "databases"],
  institutionName: "Université de test",
  goals: ["thesis", "research"],
  preferredLocale: "fr",
  ageConfirmed: true,
};

describe("profil académique", () => {
  it("accepte un profil complet", () => {
    expect(profileSchema.safeParse(valid).success).toBe(true);
  });

  it("traite les champs facultatifs vides comme absents", () => {
    const parsed = profileSchema.parse({
      ...valid,
      specialtyCode: "",
      institutionName: "",
      subjectCodes: [],
      goals: [],
    });
    expect(parsed.specialtyCode).toBeUndefined();
    expect(parsed.institutionName).toBeUndefined();
  });

  it.each([
    ["pays absent", { countryCode: "" }, "countryCode", "required"],
    ["pays en minuscules", { countryCode: "sn" }, "countryCode", "invalid_choice"],
    ["pays trop long", { countryCode: "SEN" }, "countryCode", "invalid_choice"],
    ["niveau absent", { levelCode: "" }, "levelCode", "required"],
    ["niveau mal formé", { levelCode: "Licence 3" }, "levelCode", "invalid_choice"],
    ["filière absente", { programCode: "" }, "programCode", "required"],
    ["spécialité mal formée", { specialtyCode: "'; drop table" }, "specialtyCode", "invalid_choice"],
    ["matière mal formée", { subjectCodes: ["algorithms", "<script>"] }, "subjectCodes", "invalid_choice"],
    ["objectif hors liste", { goals: ["devenir_admin"] }, "goals", "invalid_choice"],
    ["langue hors liste", { preferredLocale: "de" }, "preferredLocale", "invalid_choice"],
    ["établissement trop court", { institutionName: "x" }, "institutionName", "institution_length"],
    ["établissement trop long", { institutionName: "x".repeat(201) }, "institutionName", "institution_length"],
  ])("refuse : %s", (_label, override, field, code) => {
    const result = profileSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    if (!result.success) expect(profileFieldErrors(result.error)[field]).toBe(code);
  });

  it("refuse plus de 40 matières", () => {
    const subjectCodes = Array.from({ length: 41 }, (_, index) => `matiere_${index}`);
    expect(profileSchema.safeParse({ ...valid, subjectCodes }).success).toBe(false);
  });

  it("ne connaît aucun champ d'identité ni de rôle", () => {
    const parsed = profileSchema.parse({
      ...valid,
      userId: "00000000-0000-0000-0000-000000000000",
      role: "platform_admin",
      onboardedAt: "2020-01-01",
    });
    expect(parsed).not.toHaveProperty("userId");
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("onboardedAt");
  });
});

describe("région du profil", () => {
  it("est facultative : vide, elle est absente", () => {
    expect(profileSchema.parse({ ...valid, region: "   " }).region).toBeUndefined();
  });

  it("est normalisée comme l'exige la base", () => {
    expect(profileSchema.parse({ ...valid, region: "  Île-de-France \t " }).region).toBe("Île-de-France");
    expect(profileSchema.parse({ ...valid, region: "Grand   Casablanca" }).region).toBe("Grand Casablanca");
    expect(normalizeShortText(" a  b ")).toBe("a b");
  });

  it("accepte les écritures non latines", () => {
    expect(profileSchema.safeParse({ ...valid, region: "الرباط" }).success).toBe(true);
    expect(profileSchema.safeParse({ ...valid, region: "Luanda" }).success).toBe(true);
  });

  it.each([
    ["trop courte", "x"],
    ["trop longue", "x".repeat(101)],
    ["balise", "<b>Dakar</b>"],
    ["formule de tableur", "=HYPERLINK(1)"],
    ["tiret en tête", "-Dakar"],
    ["caractère invisible", "Da" + String.fromCodePoint(0x200b) + "kar"],
    ["inversion bidirectionnelle", "Dakar" + String.fromCodePoint(0x202e)],
    ["que des chiffres", "75 013"],
    ["que de la ponctuation", "...."],
  ])("refuse une région %s", (_label, region) => {
    const result = profileSchema.safeParse({ ...valid, region });
    expect(result.success).toBe(false);
    if (!result.success) expect(profileFieldErrors(result.error).region).toBe("region_invalid");
  });

  it("compte les caractères, pas les unités de code", () => {
    expect(isCleanShortText("é".repeat(100), 2, 100)).toBe(true);
    expect(isCleanShortText("😀a".repeat(50), 2, 100)).toBe(true);
    expect(isCleanShortText("😀a".repeat(51), 2, 100)).toBe(false);
  });
});

describe("confidentialité", () => {
  it("rien n'est public sans le demander", () => {
    expect(privacySchema.parse({ displayName: "", isPublic: false })).toEqual({
      displayName: undefined,
      isPublic: false,
    });
  });

  it("accepte un nom affiché et un profil public", () => {
    expect(privacySchema.parse({ displayName: "  Awa   Diop ", isPublic: true })).toEqual({
      displayName: "Awa Diop",
      isPublic: true,
    });
  });

  it("un profil public a un nom affiché", () => {
    const result = privacySchema.safeParse({ displayName: " ", isPublic: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(profileFieldErrors(result.error).displayName).toBe("display_name_required");
    }
  });

  it.each([
    ["trop long", "x".repeat(81)],
    ["balise", "<script>"],
    ["formule", "+33 Awa"],
    ["invisible", "Awa" + String.fromCodePoint(0x2066) + " Diop"],
  ])("refuse un nom %s", (_label, displayName) => {
    const result = privacySchema.safeParse({ displayName, isPublic: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(profileFieldErrors(result.error).displayName).toBe("display_name_invalid");
    }
  });

  it("ne connaît ni identifiant ni autre champ", () => {
    const parsed = privacySchema.parse({ displayName: "Awa", isPublic: false, userId: "x", region: "Dakar" });
    expect(Object.keys(parsed).sort()).toEqual(["displayName", "isPublic"]);
  });
});
