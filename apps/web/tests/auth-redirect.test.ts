import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "@/lib/auth/redirect";

// Modèle de menaces M-04 : aucune redirection hors du site après connexion.
describe("safeNextPath", () => {
  it("accepte un chemin interne et conserve sa requête", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/resources/10.1000/xyz?page=2")).toBe(
      "/resources/10.1000/xyz?page=2",
    );
  });

  it("retire le préfixe de langue : il est rajouté par la redirection", () => {
    expect(safeNextPath("/fr/account")).toBe("/account");
    expect(safeNextPath("/en")).toBe("/");
  });

  it.each([
    ["adresse absolue", "https://evil.example/account"],
    ["protocole relatif", "//evil.example/account"],
    ["barre oblique inverse", "/\\evil.example"],
    ["barre oblique inverse encodée après décodage", "/\\/evil.example"],
    ["schéma javascript", "javascript:alert(1)"],
    ["chemin relatif", "account"],
    ["chaîne vide", ""],
    ["retour chariot", "/account\r\nSet-Cookie: x=1"],
    ["tabulation", "/\t/evil.example"],
    ["valeur trop longue", `/${"a".repeat(600)}`],
  ])("refuse : %s", (_label, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it.each([undefined, null, 42, ["/account"], { path: "/account" }])(
    "refuse une valeur qui n'est pas une chaîne : %j",
    (value) => {
      expect(safeNextPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
    },
  );

  it.each(["/sign-in", "/fr/sign-in?next=/x", "/sign-up", "/auth/confirm", "/reset-password"])(
    "ne renvoie pas vers une page d'authentification : %s",
    (value) => {
      expect(safeNextPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
    },
  );

  it("utilise la destination de repli fournie", () => {
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
  });
});
