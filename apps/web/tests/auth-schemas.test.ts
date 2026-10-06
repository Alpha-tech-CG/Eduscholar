import { describe, expect, it } from "vitest";
import {
  confirmTokenSchema,
  fieldErrors,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { sessionCookieOptions } from "@/lib/supabase/cookies";

const valid = {
  email: "  Etudiante@Exemple.org ",
  password: "motdepasse2026", // valeur-fictive
  passwordConfirmation: "motdepasse2026", // valeur-fictive
  ageConfirmed: "on",
};

describe("inscription", () => {
  it("normalise l'adresse", () => {
    const parsed = signUpSchema.parse(valid);
    expect(parsed.email).toBe("etudiante@exemple.org");
  });

  it.each([
    ["adresse invalide", { email: "pas-une-adresse" }, "email", "email_invalid"],
    ["mot de passe court", { password: "court1", passwordConfirmation: "court1" }, "password", "password_too_short"],
    ["sans chiffre", { password: "motdepassesanschiffre", passwordConfirmation: "motdepassesanschiffre" }, "password", "password_needs_letter_and_digit"], // valeur-fictive
    ["sans lettre", { password: "123456789012", passwordConfirmation: "123456789012" }, "password", "password_needs_letter_and_digit"], // valeur-fictive
    ["confirmation différente", { passwordConfirmation: "autrechose2026" }, "passwordConfirmation", "password_mismatch"], // valeur-fictive
    ["âge non déclaré", { ageConfirmed: "" }, "ageConfirmed", "age_required"],
  ])("refuse : %s", (_label, override, field, code) => {
    const result = signUpSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)[field]).toBe(code);
  });

  it("refuse un mot de passe de plus de 72 caractères", () => {
    const password = `a1${"x".repeat(80)}`;
    const result = signUpSchema.safeParse({ ...valid, password, passwordConfirmation: password });
    expect(result.success).toBe(false);
  });
});

describe("connexion", () => {
  it("n'impose aucune règle de format au mot de passe", () => {
    expect(signInSchema.safeParse({ email: "a@b.org", password: "x" }).success).toBe(true);
  });

  it("refuse un mot de passe vide ou démesuré", () => {
    expect(signInSchema.safeParse({ email: "a@b.org", password: "" }).success).toBe(false);
    expect(
      signInSchema.safeParse({ email: "a@b.org", password: "x".repeat(2000) }).success,
    ).toBe(false);
  });
});

describe("nouveau mot de passe", () => {
  it("applique la même politique qu'à l'inscription", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "court1", passwordConfirmation: "court1" }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        password: "nouveaumotdepasse9", // valeur-fictive
        passwordConfirmation: "nouveaumotdepasse9", // valeur-fictive
      }).success,
    ).toBe(true);
  });
});

describe("jeton de confirmation", () => {
  it("accepte une empreinte et les deux types prévus", () => {
    for (const type of ["email", "recovery"]) {
      expect(confirmTokenSchema.safeParse({ tokenHash: "a".repeat(56), type }).success).toBe(true);
    }
  });

  it.each([
    ["type inconnu", { tokenHash: "a".repeat(56), type: "invite" }],
    ["jeton trop court", { tokenHash: "abc", type: "email" }],
    ["caractères interdits", { tokenHash: `${"a".repeat(30)}<script>`, type: "email" }],
    ["jeton absent", { tokenHash: undefined, type: "email" }],
  ])("refuse : %s", (_label, value) => {
    expect(confirmTokenSchema.safeParse(value).success).toBe(false);
  });
});

// ADR-0007, modèle de menaces M-03.
describe("cookies de session", () => {
  it("sont toujours HttpOnly, quelles que soient les options proposées", () => {
    const options = sessionCookieOptions({ httpOnly: false, sameSite: "none", path: "/autre" });
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("conservent la durée de vie fixée par le service d'authentification", () => {
    expect(sessionCookieOptions({ maxAge: 3600 }).maxAge).toBe(3600);
  });
});
