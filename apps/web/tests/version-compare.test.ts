import { describe, expect, it } from "vitest";
import { compareSections } from "@/lib/projects/version-compare";

const section = (id: string, title: string, digest = "empreinte-1", level = 1) => ({
  id,
  level,
  title,
  digest,
});

describe("comparaison de deux versions soumises", () => {
  it("ne compare rien pour une première version", () => {
    expect(compareSections([section("a", "Introduction")], null)).toBeNull();
  });

  it("ne signale rien quand rien n'a changé", () => {
    const sections = [section("a", "Introduction"), section("b", "Méthode")];
    expect(compareSections(sections, sections)).toEqual({ added: [], modified: [], removed: [] });
  });

  it("distingue les sections ajoutées, modifiées et retirées", () => {
    const previous = [section("a", "Introduction"), section("b", "Méthode"), section("c", "Annexe")];
    const current = [
      section("a", "Introduction", "empreinte-2"),
      section("b", "Méthode"),
      section("d", "Résultats"),
    ];
    expect(compareSections(current, previous)).toEqual({
      added: ["Résultats"],
      modified: ["Introduction"],
      removed: ["Annexe"],
    });
  });

  it("reconnaît une section renommée ou changée de niveau à son identifiant", () => {
    const previous = [section("a", "Intro"), section("b", "Méthode", "empreinte-1", 1)];
    const current = [section("a", "Introduction"), section("b", "Méthode", "empreinte-1", 2)];
    expect(compareSections(current, previous)).toEqual({
      added: [],
      modified: ["Introduction", "Méthode"],
      removed: [],
    });
  });
});
