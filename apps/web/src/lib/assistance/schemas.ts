import { z } from "zod";

// Assistance documentaire (cahier §8) : lecture de ce que rendent les fonctions
// de la base. Ce sont des suggestions et des constats calculés, jamais des
// décisions ; l'écran les montre avec ce qui les justifie, et n'applique rien.
//
// Une réponse mal formée ne fait jamais planter l'écran : elle est lue comme
// « indisponible », et un constat inconnu ou incomplet est simplement écarté.

// Identifiant : la forme que vérifie le reste de l'application, sans exiger
// les bits de version de la RFC — un identifiant valable pour la base ne doit
// pas rendre tout un rapport « indisponible ».
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuid = z.string().regex(UUID_PATTERN);
const confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidence>;

// --- Modération : fiches qui se ressemblent ------------------------------------

export const SIMILARITY_REASONS = ["same_doi", "same_url", "similar_title"] as const;
export type SimilarityReason = (typeof SIMILARITY_REASONS)[number];

const similarSchema = z.object({
  id: uuid,
  title: z.string(),
  editorial_status: z.string(),
  reason: z.enum(SIMILARITY_REASONS),
  score: z.coerce.number().catch(0),
  confidence,
});

export type SimilarResource = {
  id: string;
  title: string;
  editorialStatus: string;
  reason: SimilarityReason;
  /** De 0 à 1 : 1 pour un DOI ou un lien identique, sinon la proximité des titres. */
  score: number;
  confidence: Confidence;
};

/** `null` si la réponse n'a pas la forme attendue. */
export function parseSimilarResources(rows: unknown): SimilarResource[] | null {
  const parsed = z.array(similarSchema).max(50).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id,
    title: row.title,
    editorialStatus: row.editorial_status,
    reason: row.reason,
    score: row.score,
    confidence: row.confidence,
  }));
}

// --- Modération : matières suggérées ---------------------------------------------

const classificationSchema = z.object({
  kind: z.literal("subject"),
  code: z.string().min(1).max(60),
  labels: z.record(z.string(), z.string()).nullable().catch(null),
  matched_words: z.array(z.string()).catch([]),
  confidence,
});

export type ClassificationSuggestion = {
  code: string;
  labels: Record<string, string>;
  /** Mots de la fiche qui ont correspondu au libellé de la matière. */
  matchedWords: string[];
  confidence: Confidence;
};

/** `null` si la réponse n'a pas la forme attendue. */
export function parseClassificationSuggestions(rows: unknown): ClassificationSuggestion[] | null {
  const parsed = z.array(classificationSchema).max(50).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    code: row.code,
    labels: row.labels ?? {},
    matchedWords: row.matched_words.slice(0, 20),
    confidence: row.confidence,
  }));
}

// --- Projet : rapport de cohérence -------------------------------------------------

const base = { severity: z.enum(["info", "warning"]), count: z.number().int().min(0) };
const sections = z.array(z.object({ id: uuid, title: z.string() }));
const sourceIds = z.array(uuid);

const findingSchema = z.discriminatedUnion("code", [
  z.object({ ...base, code: z.literal("project_incomplete"), fields: z.array(z.string()) }),
  z.object({ ...base, code: z.literal("project_overdue"), days_late: z.number().int() }),
  z.object({ ...base, code: z.literal("project_due_soon"), days_left: z.number().int() }),
  z.object({ ...base, code: z.literal("task_overdue"), task_ids: z.array(uuid) }),
  z.object({ ...base, code: z.literal("section_empty"), sections }),
  z.object({ ...base, code: z.literal("section_without_citation"), sections }),
  z.object({ ...base, code: z.literal("section_single_source"), sections }),
  z.object({ ...base, code: z.literal("section_short"), sections }),
  z.object({ ...base, code: z.literal("source_never_cited"), source_ids: sourceIds }),
  z.object({
    ...base,
    code: z.literal("citation_without_pages"),
    citations: z.array(z.object({ section_id: uuid, source_id: uuid })),
  }),
  z.object({
    ...base,
    code: z.literal("source_incomplete"),
    sources: z.array(z.object({ id: uuid, missing: z.array(z.string()) })),
  }),
  z.object({ ...base, code: z.literal("source_duplicate"), groups: z.array(z.array(uuid)) }),
  z.object({ ...base, code: z.literal("literature_none_recent"), newest_year: z.number().int() }),
  z.object({ ...base, code: z.literal("literature_mostly_old"), sources_with_year: z.number().int() }),
  z.object({ ...base, code: z.literal("cited_source_without_note"), source_ids: sourceIds }),
]);

export type CoherenceFinding = z.infer<typeof findingSchema>;
export type FindingCode = CoherenceFinding["code"];

const reportSchema = z.object({
  role: z.enum(["owner", "supervisor", "viewer"]),
  totals: z.object({
    sections: z.number().int().min(0),
    sources: z.number().int().min(0),
    citations: z.number().int().min(0),
    tasks: z.number().int().min(0),
  }),
  findings: z.array(z.unknown()).max(200),
});

export type CoherenceReport = {
  role: "owner" | "supervisor" | "viewer";
  totals: { sections: number; sources: number; citations: number; tasks: number };
  findings: CoherenceFinding[];
  /** Constats rendus par la base que cet écran n'a pas su lire, et n'affiche donc pas. */
  unreadable: number;
};

/** `null` si le rapport n'a pas la forme attendue. Un constat inconnu ou incomplet est écarté, et compté. */
export function parseCoherenceReport(data: unknown): CoherenceReport | null {
  const parsed = reportSchema.safeParse(data);
  if (!parsed.success) return null;
  const findings: CoherenceFinding[] = [];
  let unreadable = 0;
  for (const raw of parsed.data.findings) {
    const finding = findingSchema.safeParse(raw);
    if (finding.success) findings.push(finding.data);
    else unreadable += 1;
  }
  return { role: parsed.data.role, totals: parsed.data.totals, findings, unreadable };
}

/** Familles du rapport, dans l'ordre de l'écran. */
export const FINDING_FAMILIES = ["project", "writing", "sources", "literature"] as const;
export type FindingFamily = (typeof FINDING_FAMILIES)[number];

const FAMILY_OF: Record<FindingCode, FindingFamily> = {
  project_incomplete: "project",
  project_overdue: "project",
  project_due_soon: "project",
  task_overdue: "project",
  section_empty: "writing",
  section_without_citation: "writing",
  section_single_source: "writing",
  section_short: "writing",
  source_never_cited: "sources",
  citation_without_pages: "sources",
  source_incomplete: "sources",
  source_duplicate: "sources",
  cited_source_without_note: "sources",
  literature_none_recent: "literature",
  literature_mostly_old: "literature",
};

export function findingFamily(code: FindingCode): FindingFamily {
  return FAMILY_OF[code];
}

/** Constats regroupés par famille : les familles vides sont omises ; « à vérifier » avant « information ». */
export function groupFindings(
  findings: CoherenceFinding[],
): { family: FindingFamily; findings: CoherenceFinding[] }[] {
  return FINDING_FAMILIES.map((family) => ({
    family,
    findings: findings
      .filter((finding) => FAMILY_OF[finding.code] === family)
      // Tri stable : l'ordre de la base est gardé au sein d'un même niveau.
      .sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning")),
  })).filter((group) => group.findings.length > 0);
}

/** Champs de la fiche du projet que le rapport peut dire vides, et leur nom dans les messages. */
export const PROJECT_FIELD_KEYS = {
  problem_statement: "problemStatement",
  main_question: "mainQuestion",
  general_objective: "generalObjective",
  methodology: "methodology",
} as const;

/** Champs d'une source que le rapport peut dire manquants. */
export const SOURCE_FIELD_KEYS = ["authors", "publication_year", "title"] as const;
export type SourceFieldKey = (typeof SOURCE_FIELD_KEYS)[number];

export function knownSourceFields(missing: string[]): SourceFieldKey[] {
  return SOURCE_FIELD_KEYS.filter((field) => missing.includes(field));
}

// --- Liens du rapport ------------------------------------------------------------------

/** « owner » : pages de travail du propriétaire ; « member » : pages du projet partagé. */
export type ReportScope = "owner" | "member";

const UUID = UUID_PATTERN;

/** Liens vers ce qu'un constat désigne. `null` quand la page n'existe pas pour ce lecteur. */
export function reportLinks(scope: ReportScope, projectId: string) {
  const root = scope === "owner" ? `/projects/${projectId}` : `/shared/${projectId}`;
  return {
    back: root,
    section: (sectionId: string): string | null =>
      !UUID.test(sectionId)
        ? null
        : scope === "owner"
          ? `${root}/outline/${sectionId}`
          : `${root}/sections/${sectionId}`,
    tasks: `${root}/tasks`,
    // Les pages des sources et la fiche du projet ne sont ouvertes qu'au propriétaire.
    source: (sourceId: string): string | null =>
      scope === "owner" && UUID.test(sourceId) ? `${root}/sources/${sourceId}` : null,
    sources: scope === "owner" ? `${root}/sources` : null,
    edit: scope === "owner" ? `${root}/edit` : null,
  };
}

// --- Recommandations ------------------------------------------------------------------------

export const RECOMMENDATION_REASONS = [
  "same_program",
  "same_subject",
  "same_level",
  "cited_authors",
  "project_keywords",
] as const;
export type RecommendationReason = (typeof RECOMMENDATION_REASONS)[number];

const recommendationSchema = z.object({
  id: uuid,
  score: z.coerce.number().catch(0),
  reasons: z.array(z.string()).catch([]),
});

export type Recommendation = { id: string; reasons: RecommendationReason[] };

/** `null` si la réponse n'a pas la forme attendue. Une raison inconnue est écartée. */
export function parseRecommendations(rows: unknown): Recommendation[] | null {
  const parsed = z.array(recommendationSchema).max(50).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id,
    reasons: RECOMMENDATION_REASONS.filter((reason) => row.reasons.includes(reason)),
  }));
}

/** Projet choisi dans l'adresse : seulement s'il figure parmi ceux de l'utilisateur. */
export function chosenProject(value: unknown, ownProjectIds: string[]): string | null {
  return typeof value === "string" && UUID.test(value) && ownProjectIds.includes(value) ? value : null;
}
