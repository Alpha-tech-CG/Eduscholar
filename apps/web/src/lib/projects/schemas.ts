import { z } from "zod";

// Fiche d'un projet de recherche (cahier §6.7). Les bornes reprennent celles
// de la base, qui reste seule à faire foi.

export const PROJECT_STATUSES = ["draft", "in_progress", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectFieldErrorCode =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_choice"
  | "invalid_date"
  | "too_many";

const empty = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const longText = (max: number) =>
  z.preprocess(empty, z.string().trim().max(max, "too_long").optional());
const list = z.array(z.string().trim().min(1).max(1000, "too_long")).max(20, "too_many");

/** Découpe une saisie d'un élément par ligne, sans doublon ni ligne vide. */
export function splitLines(value: string): string[] {
  const seen = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const item = line.trim().replace(/\s+/g, " ");
    if (item) seen.add(item);
  }
  return [...seen];
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Mêmes bornes que la base.
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(value) &&
    value >= "2000-01-01" &&
    value <= "2100-12-31"
  );
}

const title = z.string().trim().min(3, "too_short").max(300, "too_long");
const programCode = z.preprocess(
  empty,
  z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, "invalid_choice").optional(),
);

export const newProjectSchema = z.object({ title, programCode });

export const projectSchema = z.object({
  title,
  programCode,
  status: z.enum(PROJECT_STATUSES, "invalid_choice"),
  dueDate: z.preprocess(empty, z.string().refine(isRealDate, "invalid_date").optional()),
  supervisorName: z.preprocess(empty, z.string().trim().max(200, "too_long").optional()),
  context: longText(5000),
  problemStatement: longText(5000),
  mainQuestion: longText(1000),
  secondaryQuestions: list,
  hypotheses: list,
  generalObjective: longText(1000),
  specificObjectives: list,
  theoreticalFramework: longText(5000),
  methodology: longText(5000),
  fieldwork: longText(2000),
  populationSample: longText(2000),
  outline: longText(10000),
});

export type ProjectInput = z.infer<typeof projectSchema>;

/** Charge utile attendue par `update_project`. */
export function toProjectPayload(input: ProjectInput) {
  return {
    title: input.title,
    program_code: input.programCode ?? "",
    status: input.status,
    due_date: input.dueDate ?? "",
    supervisor_name: input.supervisorName ?? "",
    context: input.context ?? "",
    problem_statement: input.problemStatement ?? "",
    main_question: input.mainQuestion ?? "",
    secondary_questions: input.secondaryQuestions,
    hypotheses: input.hypotheses,
    general_objective: input.generalObjective ?? "",
    specific_objectives: input.specificObjectives,
    theoretical_framework: input.theoreticalFramework ?? "",
    methodology: input.methodology ?? "",
    fieldwork: input.fieldwork ?? "",
    population_sample: input.populationSample ?? "",
    outline: input.outline ?? "",
  };
}

const CODES: readonly ProjectFieldErrorCode[] = [
  "required",
  "too_short",
  "too_long",
  "invalid_choice",
  "invalid_date",
  "too_many",
];

export function projectFieldErrors(error: z.ZodError): Record<string, ProjectFieldErrorCode> {
  const fields: Record<string, ProjectFieldErrorCode> = {};
  for (const issue of error.issues) {
    const name = String(issue.path[0] ?? "");
    if (!name || fields[name]) continue;
    const code = CODES.find((candidate) => candidate === issue.message);
    fields[name] = code ?? (issue.code === "too_big" ? "too_long" : "required");
  }
  return fields;
}
