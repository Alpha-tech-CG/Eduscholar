import { describe, expect, it } from "vitest";
import {
  chosenProject,
  FINDING_FAMILIES,
  findingFamily,
  groupFindings,
  knownSourceFields,
  parseClassificationSuggestions,
  parseCoherenceReport,
  parseRecommendations,
  parseSimilarResources,
  PROJECT_FIELD_KEYS,
  reportLinks,
  type CoherenceFinding,
} from "@/lib/assistance/schemas";

const a = "10000000-0000-4000-8000-000000000001";
const b = "20000000-0000-4000-8000-000000000002";
const c = "30000000-0000-4000-8000-000000000003";

// Ce qu'une réponse mal formée peut être : rien de tout cela ne doit faire planter l'écran.
const malformed = [null, undefined, "erreur", 42, {}, { message: "forbidden" }, [null], ["x"], [{}], [[]]];

describe("fiches qui se ressemblent", () => {
  it("lit les lignes de la base", () => {
    expect(
      parseSimilarResources([
        { id: a, title: "Cryptographie appliquée", editorial_status: "published", reason: "same_doi", score: 1, confidence: "high" },
        { id: b, title: "Cryptographie appliquee", editorial_status: "pending", reason: "similar_title", score: "0.82", confidence: "medium" },
      ]),
    ).toEqual([
      { id: a, title: "Cryptographie appliquée", editorialStatus: "published", reason: "same_doi", score: 1, confidence: "high" },
      { id: b, title: "Cryptographie appliquee", editorialStatus: "pending", reason: "similar_title", score: 0.82, confidence: "medium" },
    ]);
    expect(parseSimilarResources([])).toEqual([]);
  });

  it.each(malformed)("rend « indisponible » pour %j", (value) => {
    expect(parseSimilarResources(value)).toBeNull();
  });

  it("refuse une raison, une confiance ou un identifiant inconnus", () => {
    const row = { id: a, title: "T", editorial_status: "pending", reason: "same_doi", score: 1, confidence: "high" };
    expect(parseSimilarResources([{ ...row, reason: "same_author" }])).toBeNull();
    expect(parseSimilarResources([{ ...row, confidence: "certain" }])).toBeNull();
    expect(parseSimilarResources([{ ...row, id: "1" }])).toBeNull();
    // Un score illisible ne condamne pas la ligne : il vaut zéro.
    expect(parseSimilarResources([{ ...row, score: "beaucoup" }])?.[0]?.score).toBe(0);
  });
});

describe("matières suggérées", () => {
  it("lit les lignes de la base", () => {
    expect(
      parseClassificationSuggestions([
        { kind: "subject", code: "cryptography", labels: { fr: "Cryptographie", en: "Cryptography" }, matched_words: ["cryptographie"], confidence: "high" },
        { kind: "subject", code: "algorithms", labels: null, matched_words: null, confidence: "low" },
      ]),
    ).toEqual([
      { code: "cryptography", labels: { fr: "Cryptographie", en: "Cryptography" }, matchedWords: ["cryptographie"], confidence: "high" },
      { code: "algorithms", labels: {}, matchedWords: [], confidence: "low" },
    ]);
  });

  it.each(malformed)("rend « indisponible » pour %j", (value) => {
    expect(parseClassificationSuggestions(value)).toBeNull();
  });

  it("n'admet que des matières", () => {
    expect(
      parseClassificationSuggestions([{ kind: "level", code: "master_1", labels: {}, matched_words: [], confidence: "low" }]),
    ).toBeNull();
  });
});

describe("rapport de cohérence", () => {
  const totals = { sections: 3, sources: 2, citations: 1, tasks: 0 };
  const findings = [
    { code: "project_incomplete", severity: "warning", count: 2, fields: ["main_question", "methodology"] },
    { code: "project_due_soon", severity: "info", count: 1, days_left: 12 },
    { code: "section_empty", severity: "info", count: 1, sections: [{ id: a, title: "Introduction" }] },
    { code: "section_without_citation", severity: "warning", count: 1, sections: [{ id: b, title: "Méthode" }] },
    { code: "source_never_cited", severity: "info", count: 1, source_ids: [c] },
    { code: "source_incomplete", severity: "warning", count: 1, sources: [{ id: c, missing: ["authors", "publication_year"] }] },
    { code: "citation_without_pages", severity: "info", count: 1, citations: [{ section_id: b, source_id: c }] },
    { code: "source_duplicate", severity: "warning", count: 1, groups: [[a, b]] },
    { code: "literature_none_recent", severity: "warning", count: 2, newest_year: 2009 },
    { code: "cited_source_without_note", severity: "info", count: 1, source_ids: [c] },
  ];

  it("lit le rapport et tous ses constats", () => {
    const report = parseCoherenceReport({ project_id: a, role: "owner", totals, findings });
    expect(report).not.toBeNull();
    expect(report?.role).toBe("owner");
    expect(report?.totals).toEqual(totals);
    expect(report?.findings.map(({ code }) => code)).toEqual(findings.map(({ code }) => code));
    expect(report?.unreadable).toBe(0);
  });

  it.each([...malformed, { role: "owner", totals }, { role: "stranger", totals, findings: [] }, { role: "owner", totals: {}, findings: [] }])(
    "rend « indisponible » pour %j",
    (value) => {
      expect(parseCoherenceReport(value)).toBeNull();
    },
  );

  it("écarte, en les comptant, les constats inconnus ou incomplets", () => {
    const report = parseCoherenceReport({
      role: "viewer",
      totals,
      findings: [
        findings[3],
        { code: "futur_constat", severity: "info", count: 1 },
        { code: "section_empty", severity: "info", count: 1 },
        { code: "section_empty", severity: "grave", count: 1, sections: [] },
        { code: "source_never_cited", severity: "info", count: 1, source_ids: ["pas-un-identifiant"] },
        null,
        "texte",
      ],
    });
    expect(report?.findings.map(({ code }) => code)).toEqual(["section_without_citation"]);
    expect(report?.unreadable).toBe(6);
  });

  it("chaque constat a sa famille, et les quatre familles existent", () => {
    expect([...FINDING_FAMILIES]).toEqual(["project", "writing", "sources", "literature"]);
    expect(findingFamily("task_overdue")).toBe("project");
    expect(findingFamily("section_short")).toBe("writing");
    expect(findingFamily("cited_source_without_note")).toBe("sources");
    expect(findingFamily("literature_mostly_old")).toBe("literature");
  });

  it("regroupe par famille, dans l'ordre de l'écran, « à vérifier » d'abord", () => {
    const report = parseCoherenceReport({ role: "owner", totals, findings });
    const groups = groupFindings(report?.findings ?? []);
    expect(groups.map(({ family }) => family)).toEqual(["project", "writing", "sources", "literature"]);
    expect(groups[0]?.findings.map(({ code }) => code)).toEqual(["project_incomplete", "project_due_soon"]);
    expect(groups[1]?.findings.map(({ code }) => code)).toEqual(["section_without_citation", "section_empty"]);
    expect(groups[2]?.findings.map(({ code }) => code)).toEqual([
      "source_incomplete",
      "source_duplicate",
      "source_never_cited",
      "citation_without_pages",
      "cited_source_without_note",
    ]);
    expect(groups[3]?.findings.map(({ code }) => code)).toEqual(["literature_none_recent"]);
  });

  it("omet les familles sans constat", () => {
    const only: CoherenceFinding[] = [{ code: "literature_mostly_old", severity: "info", count: 4, sources_with_year: 5 }];
    expect(groupFindings(only).map(({ family }) => family)).toEqual(["literature"]);
    expect(groupFindings([])).toEqual([]);
  });

  it("ne nomme que les champs connus", () => {
    expect(Object.keys(PROJECT_FIELD_KEYS)).toEqual(["problem_statement", "main_question", "general_objective", "methodology"]);
    expect(knownSourceFields(["title", "inconnu", "authors"])).toEqual(["authors", "title"]);
    expect(knownSourceFields([])).toEqual([]);
  });
});

describe("liens du rapport", () => {
  it("propriétaire : pages de travail du projet", () => {
    const links = reportLinks("owner", a);
    expect(links.back).toBe(`/projects/${a}`);
    expect(links.section(b)).toBe(`/projects/${a}/outline/${b}`);
    expect(links.source(c)).toBe(`/projects/${a}/sources/${c}`);
    expect(links.sources).toBe(`/projects/${a}/sources`);
    expect(links.tasks).toBe(`/projects/${a}/tasks`);
    expect(links.edit).toBe(`/projects/${a}/edit`);
  });

  it("membre : pages du projet partagé, sans celles qui ne lui sont pas ouvertes", () => {
    const links = reportLinks("member", a);
    expect(links.back).toBe(`/shared/${a}`);
    expect(links.section(b)).toBe(`/shared/${a}/sections/${b}`);
    expect(links.tasks).toBe(`/shared/${a}/tasks`);
    expect(links.source(c)).toBeNull();
    expect(links.sources).toBeNull();
    expect(links.edit).toBeNull();
  });

  it("ne construit pas de lien à partir d'un identifiant qui n'en est pas un", () => {
    for (const scope of ["owner", "member"] as const) {
      expect(reportLinks(scope, a).section("../../admin")).toBeNull();
      expect(reportLinks(scope, a).section("")).toBeNull();
    }
    expect(reportLinks("owner", a).source("x/y")).toBeNull();
  });
});

describe("recommandations", () => {
  it("garde l'ordre de la base et les seules raisons connues", () => {
    expect(
      parseRecommendations([
        { id: a, score: 12, reasons: ["same_program", "same_subject", "same_level"] },
        { id: b, score: 5, reasons: ["cited_authors", "populaire_chez_les_autres", "same_program"] },
        { id: c, score: 1, reasons: null },
      ]),
    ).toEqual([
      { id: a, reasons: ["same_program", "same_subject", "same_level"] },
      { id: b, reasons: ["same_program", "cited_authors"] },
      { id: c, reasons: [] },
    ]);
    expect(parseRecommendations([])).toEqual([]);
  });

  it.each(malformed)("rend « indisponible » pour %j", (value) => {
    expect(parseRecommendations(value)).toBeNull();
  });

  it("le projet de l'adresse ne vaut que parmi les siens", () => {
    expect(chosenProject(a, [a, b])).toBe(a);
    expect(chosenProject(c, [a, b])).toBeNull();
    expect(chosenProject("", [a])).toBeNull();
    expect(chosenProject([a], [a])).toBeNull();
    expect(chosenProject(undefined, [a])).toBeNull();
    expect(chosenProject("pas-un-identifiant", ["pas-un-identifiant"])).toBeNull();
  });
});
