import { describe, expect, it } from "vitest";
import { profileFieldErrors, profileSchema } from "@/lib/profile/schemas";

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
