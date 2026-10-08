import "server-only";
import { createSessionClient } from "@/lib/supabase/server";

// Export des données personnelles (droit d'accès et de portabilité).
//
// Tout est lu sous la session de l'utilisateur, ET chaque lecture est filtrée
// explicitement sur le titulaire. La RLS seule ne suffit pas : certaines
// politiques ont une branche par rôle (un modérateur lit tous les signalements),
// et l'export d'une personne ne doit contenir que ce qui lui appartient.

type Client = Awaited<ReturnType<typeof createSessionClient>>;
type Row = Record<string, unknown>;

class ExportError extends Error {}

const PAGE = 100;
const MAX_ROWS = 20000;

/**
 * Lit une table par pages, l'API plafonnant chaque réponse. `orderBy` se
 * termine par une clé unique, pour qu'aucune ligne ne soit sautée ni doublée.
 * Au-delà du plafond, l'export échoue plutôt que d'être remis incomplet.
 */
async function readAll(
  supabase: Client,
  table: string,
  columns: string,
  orderBy: string[],
  filter: { column: string; values: string[] },
): Promise<Row[]> {
  const rows: Row[] = [];
  if (filter.values.length === 0) return rows;

  for (let from = 0; ; from += PAGE) {
    if (from >= MAX_ROWS) throw new ExportError(table);
    // Les noms de table et de colonne sont des constantes de ce module.
    let query = supabase.from(table as never).select(columns).in(filter.column, filter.values);
    for (const column of orderBy) query = query.order(column);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new ExportError(table);
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** Découpe une liste d'identifiants : un filtre trop long ne tient pas dans une adresse. */
async function readByIds(
  supabase: Client,
  table: string,
  columns: string,
  orderBy: string[],
  column: string,
  ids: string[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    rows.push(
      ...(await readAll(supabase, table, columns, orderBy, {
        column,
        values: ids.slice(start, start + 50),
      })),
    );
  }
  return rows;
}

/** Lit, page par page, ce qu'une fonction de la base rend pour l'appelant. */
async function ownRows(
  supabase: Client,
  fn:
    | "my_account_events"
    | "my_deleted_projects"
    | "my_project_comments"
    | "my_thesis_versions"
    | "my_project_tasks"
    | "my_version_decisions"
    | "my_known_devices"
    | "my_organization_memberships",
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    if (from >= MAX_ROWS) throw new ExportError(fn);
    const { data, error } = await supabase.rpc(fn).range(from, from + PAGE - 1);
    if (error) throw new ExportError(fn);
    rows.push(...((data ?? []) as unknown[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function ownIds(supabase: Client, fn: "my_submission_ids" | "my_report_ids"): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    if (from >= MAX_ROWS) throw new ExportError(fn);
    const { data, error } = await supabase.rpc(fn).range(from, from + PAGE - 1);
    if (error) throw new ExportError(fn);
    ids.push(...((data ?? []) as string[]));
    if ((data ?? []).length < PAGE) break;
  }
  return ids;
}

export type PersonalDataExport = Record<string, unknown>;

/**
 * `null` si une lecture échoue, si un plafond est dépassé ou si le compte n'a
 * pas de profil lisible (compte suspendu) : aucun export partiel n'est remis.
 */
export async function buildPersonalDataExport(
  user: { id: string; email?: string | null; created_at?: string },
): Promise<PersonalDataExport | null> {
  const supabase = await createSessionClient();
  const me = { column: "user_id", values: [user.id] };

  try {
    const profile = await readAll(
      supabase,
      "profiles",
      "preferred_locale, country_code, level_code, program_code, specialty_code, subject_codes, institution_name, goals, age_confirmed_at, onboarded_at, created_at, updated_at",
      ["user_id"],
      me,
    );
    if (profile.length === 0) return null;

    const publicProfile = await readAll(
      supabase, "profile_public", "display_name, is_public, updated_at", ["user_id"], me,
    );
    const roles = await readAll(supabase, "platform_roles", "role, granted_at", ["granted_at", "role"], me);

    const favorites = await readAll(
      supabase, "resource_favorites", "resource_id, created_at", ["created_at", "resource_id"], me,
    );
    const collections = await readAll(
      supabase, "collections", "id, name, description, created_at, updated_at", ["created_at", "id"],
      { column: "owner_id", values: [user.id] },
    );
    const collectionItems = await readByIds(
      supabase, "collection_items", "collection_id, resource_id, added_at",
      ["collection_id", "resource_id"], "collection_id", collections.map((row) => String(row.id)),
    );

    const projects = await readAll(
      supabase,
      "research_projects",
      "id, title, program_code, status, due_date, supervisor_name, context, problem_statement, main_question, secondary_questions, hypotheses, general_objective, specific_objectives, theoretical_framework, methodology, fieldwork, population_sample, outline, created_at, updated_at",
      ["created_at", "id"],
      { column: "owner_id", values: [user.id] },
    );
    const projectIds = projects.map((row) => String(row.id));
    const sources = await readByIds(
      supabase, "project_sources",
      "id, project_id, resource_id, source_type, title, authors, publication_year, container_title, publisher, volume, issue, pages, doi, url, accessed_on, created_at, updated_at",
      ["project_id", "id"], "project_id", projectIds,
    );
    const notes = await readByIds(
      supabase, "literature_notes",
      "source_id, problem, concepts, method, population_field, results, limits, useful_quote, quote_pages, project_link, target_chapter, updated_at",
      ["source_id"], "source_id", sources.map((row) => String(row.id)),
    );
    const sections = await readByIds(
      supabase, "thesis_sections", "id, project_id, position, level, title, body, created_at, updated_at",
      ["project_id", "position"], "project_id", projectIds,
    );
    const citations = await readByIds(
      supabase, "section_citations", "section_id, source_id, pages, created_at",
      ["section_id", "source_id"], "section_id", sections.map((row) => String(row.id)),
    );

    // Propositions et signalements : la base renvoie elle-même les identifiants
    // de ceux de l'appelant, quel que soit son rôle.
    const submissions = await readByIds(
      supabase, "resources",
      "id, type_code, title, abstract, authors, institution_name, publication_year, thesis_degree, language_code, country_code, program_code, level_codes, subject_codes, tags, official_url, doi, access_status, license_code, editorial_status, created_at, updated_at",
      ["id"], "id", await ownIds(supabase, "my_submission_ids"),
    );
    const submissionHistory = await readByIds(
      supabase, "resource_status_history", "id, resource_id, from_status, to_status, action, reason, occurred_at",
      ["resource_id", "id"], "resource_id", submissions.map((row) => String(row.id)),
    );
    const reports = await readByIds(
      supabase, "resource_reports",
      "id, resource_id, reason, details, status, resolution_note, handled_at, created_at",
      ["id"], "id", await ownIds(supabase, "my_report_ids"),
    );

    // Projets supprimés en attente de purge, et événements du journal qui
    // concernent le compte : la base les rend elle-même, pour l'appelant seul.
    const deletedProjects = await ownRows(supabase, "my_deleted_projects");
    const accountEvents = await ownRows(supabase, "my_account_events");
    // Commentaires écrits par le titulaire, sur ses projets ou ceux qu'il suit.
    const projectComments = await ownRows(supabase, "my_project_comments");
    // Versions soumises (sans leur document, lisible dans l'application) et
    // décisions rendues sur les projets des autres.
    const submittedVersions = await ownRows(supabase, "my_thesis_versions");
    const versionDecisions = await ownRows(supabase, "my_version_decisions");
    // Tâches de ses projets, et celles qu'il a posées sur les projets des autres.
    const projectTasks = await ownRows(supabase, "my_project_tasks");
    // Navigateurs depuis lesquels il s'est connecté : deux dates chacun.
    const knownDevices = await ownRows(supabase, "my_known_devices");
    // Organisations dont il est membre : leur nom, son rôle, la date d'entrée.
    const organizationMemberships = await ownRows(supabase, "my_organization_memberships");
    // Son choix de recevoir, ou non, le courriel des notifications.
    const emailDigest = await supabase.rpc("my_notification_preferences");
    if (emailDigest.error) throw new ExportError("my_notification_preferences");

    return {
      format: "eduscholar-personal-data",
      version: 2,
      exported_at: new Date().toISOString(),
      account: { id: user.id, email: user.email ?? null, created_at: user.created_at ?? null },
      profile: profile[0] ?? null,
      public_profile: publicProfile[0] ?? null,
      platform_roles: roles,
      library: { favorites, collections, collection_items: collectionItems },
      research: {
        projects,
        sources,
        literature_notes: notes,
        sections,
        section_citations: citations,
        deleted_projects_pending_purge: deletedProjects,
        comments_written: projectComments,
        submitted_versions: submittedVersions,
        version_decisions_given: versionDecisions,
        tasks: projectTasks,
      },
      preferences: { notification_email: emailDigest.data === true },
      organizations: { memberships: organizationMemberships },
      known_browsers: knownDevices,
      // Date et nature seulement : ni l'auteur d'une décision, ni ses détails.
      account_events: accountEvents,
      catalogue: { submissions, submission_history: submissionHistory, reports },
      // Ce que cette copie ne contient pas, pour qu'elle ne passe pas pour exhaustive.
      not_included: [
        "documents_of_submitted_versions",
        "notifications",
        "rights_declaration_and_comments_sent_with_submissions",
      ],
    };
  } catch (error) {
    if (error instanceof ExportError) return null;
    throw error;
  }
}
