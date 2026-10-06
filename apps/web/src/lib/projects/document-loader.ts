import "server-only";
import type { BibliographyLocale } from "./bibliography";
import { buildDocument, countLines, DOCUMENT_MAX_LINES, type ProjectDocument } from "./document";
import { getProject, type Project } from "./queries";
import { getCitationsBySection, getSectionContents } from "./section-queries";
import { getAllSources } from "./source-queries";

// Lecture du document d'un projet, sous la session de l'utilisateur : la RLS
// ne lui livre que son propre projet.

export type LoadedDocument =
  | { status: "ok"; project: Project; document: ProjectDocument }
  /** Projet inexistant, supprimé ou d'autrui : même réponse. */
  | { status: "not_found" }
  /** Une lecture a échoué : aucun document partiel n'est produit. */
  | { status: "failed"; project: Project }
  /** Document démesuré (dizaines de milliers de lignes) : il n'est pas produit. */
  | { status: "too_large"; project: Project };

/** Langue du document : celle demandée si elle est connue, sinon celle de l'interface. */
export function documentLocale(requested: unknown, uiLocale: string): BibliographyLocale {
  const value = Array.isArray(requested) ? requested[0] : requested;
  if (value === "fr" || value === "en") return value;
  return uiLocale === "en" ? "en" : "fr";
}

export async function loadDocument(
  projectId: string,
  locale: BibliographyLocale,
): Promise<LoadedDocument> {
  const project = await getProject(projectId);
  if (!project) return { status: "not_found" };

  const [sections, sources] = await Promise.all([
    getSectionContents(project.id),
    getAllSources(project.id),
  ]);
  if (sections === null || sources === null) return { status: "failed", project };

  const citations = await getCitationsBySection(sections.map((section) => section.id));
  if (citations === null) return { status: "failed", project };

  const document = buildDocument(
    {
      title: project.title,
      supervisorName: project.supervisorName,
      sections,
      citations,
      sources,
    },
    locale,
  );
  if (countLines(document) > DOCUMENT_MAX_LINES) return { status: "too_large", project };

  return { status: "ok", project, document };
}
