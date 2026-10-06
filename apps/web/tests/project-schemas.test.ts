import { describe, expect, it } from "vitest";
import {
  newProjectSchema,
  projectFieldErrors,
  projectSchema,
  splitLines,
  toProjectPayload,
} from "@/lib/projects/schemas";

const valid = {
  title: "Détection d'intrusions",
  programCode: "computer_science",
  status: "in_progress",
  dueDate: "2027-06-30",
  supervisorName: "",
  context: "",
  problemStatement: "Première ligne.\nSeconde ligne.",
  mainQuestion: "",
  secondaryQuestions: ["Quel coût ?"],
  hypotheses: [],
  generalObjective: "",
  specificObjectives: [],
  theoreticalFramework: "",
  methodology: "",
  fieldwork: "",
  populationSample: "",
  outline: "",
};

describe("listes saisies une ligne par élément", () => {
  it("retire lignes vides, espaces superflus et doublons", () => {
    expect(splitLines("  Quel coût ?  \r\n\n Quelles   données ?\nQuel coût ?\n")).toEqual([
      "Quel coût ?",
      "Quelles données ?",
    ]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("fiche d'un projet", () => {
  it("accepte une fiche partielle et prépare la charge utile", () => {
    const parsed = projectSchema.parse(valid);
    expect(toProjectPayload(parsed)).toMatchObject({
      title: "Détection d'intrusions",
      program_code: "computer_science",
      status: "in_progress",
      due_date: "2027-06-30",
      supervisor_name: "",
      problem_statement: "Première ligne.\nSeconde ligne.",
      secondary_questions: ["Quel coût ?"],
      hypotheses: [],
    });
  });

  it("n'envoie que les champs de la fiche", () => {
    const payload = toProjectPayload(projectSchema.parse({ ...valid, ownerId: "x", deletedAt: "y" }));
    expect(Object.keys(payload).sort()).toEqual(
      [
        "context", "due_date", "fieldwork", "general_objective", "hypotheses", "main_question",
        "methodology", "outline", "population_sample", "problem_statement", "program_code",
        "secondary_questions", "specific_objectives", "status", "supervisor_name",
        "theoretical_framework", "title",
      ].sort(),
    );
  });

  it("signale chaque champ fautif par un code", () => {
    const result = projectSchema.safeParse({
      ...valid,
      title: "ab",
      status: "published",
      dueDate: "2027-02-30",
      context: "a".repeat(5001),
      hypotheses: Array.from({ length: 21 }, (_, index) => `Hypothèse ${index}`),
      programCode: "Filière !",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(projectFieldErrors(result.error)).toEqual({
      title: "too_short",
      status: "invalid_choice",
      dueDate: "invalid_date",
      context: "too_long",
      hypotheses: "too_many",
      programCode: "invalid_choice",
    });
  });

  it("refuse les dates qui n'existent pas ou mal formées", () => {
    for (const dueDate of [
      "30/06/2027", "2027-6-30", "2027-13-01", "2027-02-29", "demain", "infinity", "0000-01-01",
      "1999-12-31", "2101-01-01",
    ]) {
      expect(projectSchema.safeParse({ ...valid, dueDate }).success, dueDate).toBe(false);
    }
    expect(projectSchema.safeParse({ ...valid, dueDate: "2028-02-29" }).success).toBe(true);
    expect(projectSchema.safeParse({ ...valid, dueDate: "" }).success).toBe(true);
  });
});

describe("création d'un projet", () => {
  it("n'exige qu'un titre", () => {
    expect(newProjectSchema.safeParse({ title: "Mon mémoire", programCode: "" }).success).toBe(true);
    expect(newProjectSchema.safeParse({ title: "  a ", programCode: "" }).success).toBe(false);
  });
});
