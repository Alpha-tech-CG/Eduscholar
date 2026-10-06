import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

// Projets de recherche. Lectures faites sous le jeton de l'utilisateur : la RLS
// ne lui montre que ses propres projets, non supprimés.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SUMMARY_COLUMNS = "id, title, status, due_date, updated_at";
const PROJECT_COLUMNS =
  "id, title, program_code, status, due_date, supervisor_name, context, problem_statement, main_question, secondary_questions, hypotheses, general_objective, specific_objectives, theoretical_framework, methodology, fieldwork, population_sample, outline, created_at, updated_at";

export type ProjectSummary = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  updatedAt: string;
};

export type Project = ProjectSummary & {
  programCode: string | null;
  supervisorName: string | null;
  context: string | null;
  problemStatement: string | null;
  mainQuestion: string | null;
  secondaryQuestions: string[];
  hypotheses: string[];
  generalObjective: string | null;
  specificObjectives: string[];
  theoreticalFramework: string | null;
  methodology: string | null;
  fieldwork: string | null;
  populationSample: string | null;
  outline: string | null;
  createdAt: string;
};

export async function getProjects(): Promise<ProjectSummary[]> {
  const supabase = await createSessionClient();
  const { data } = await supabase
    .from("research_projects")
    .select(SUMMARY_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    updatedAt: row.updated_at,
  }));
}

/** Un projet de l'utilisateur courant, ou `null` : inexistant et « pas à vous » se confondent. */
export async function getProject(id: string): Promise<Project | null> {
  if (!UUID.test(id)) return null;

  const supabase = await createSessionClient();
  const { data: row, error } = await supabase
    .from("research_projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return null;

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    updatedAt: row.updated_at,
    programCode: row.program_code,
    supervisorName: row.supervisor_name,
    context: row.context,
    problemStatement: row.problem_statement,
    mainQuestion: row.main_question,
    secondaryQuestions: row.secondary_questions,
    hypotheses: row.hypotheses,
    generalObjective: row.general_objective,
    specificObjectives: row.specific_objectives,
    theoreticalFramework: row.theoretical_framework,
    methodology: row.methodology,
    fieldwork: row.fieldwork,
    populationSample: row.population_sample,
    outline: row.outline,
    createdAt: row.created_at,
  };
}
