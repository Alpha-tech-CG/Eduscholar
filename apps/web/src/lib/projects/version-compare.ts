// Ce qui distingue une version soumise de la précédente, section par section.
// Les sections se reconnaissent à leur identifiant, qui ne change pas quand
// on les renomme ou les déplace ; leur texte se compare par son empreinte,
// calculée par la base : celui de la version précédente n'est pas transporté.

export type SectionDigest = { id: string; level: number; title: string; digest: string };

/** `null` : pas de version précédente. Sinon, les titres des sections concernées. */
export type VersionChanges = { added: string[]; modified: string[]; removed: string[] } | null;

export function compareSections(
  current: SectionDigest[],
  previous: SectionDigest[] | null,
): VersionChanges {
  if (!previous) return null;
  const before = new Map(previous.map((section) => [section.id, section]));
  const now = new Set(current.map((section) => section.id));
  const added: string[] = [];
  const modified: string[] = [];
  for (const section of current) {
    const old = before.get(section.id);
    if (!old) added.push(section.title);
    else if (old.title !== section.title || old.digest !== section.digest || old.level !== section.level) {
      modified.push(section.title);
    }
  }
  const removed = previous.filter((section) => !now.has(section.id)).map((section) => section.title);
  return { added, modified, removed };
}
