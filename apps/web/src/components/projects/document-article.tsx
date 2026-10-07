import type { ProjectDocument } from "@/lib/projects/document";

// Le document d'un projet, tel qu'il s'imprime : page de titre, sommaire,
// sections, références. Rendu par la page du propriétaire et par celle d'un
// membre invité ; tout le texte passe par des nœuds de texte.

const HEADING = ["text-xl font-semibold", "text-lg font-semibold", "font-semibold italic"] as const;

type Props = {
  document: ProjectDocument;
  /** Langue du document. */
  locale: string;
  /** Langue de l'interface, pour le message d'un document vide. */
  uiLocale: string;
  emptyLabel: string;
};

export function DocumentArticle({ document, locale, uiLocale, emptyLabel }: Props) {
  return (
    <article lang={locale} data-testid="document" className="flex flex-col gap-4">
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-3xl font-semibold" data-testid="document-title">
          {document.title}
        </p>
        {document.supervisorName ? (
          <p>
            {document.labels.supervisor} {document.supervisorName}
          </p>
        ) : null}
      </header>

      {document.sections.length === 0 ? (
        <p className="opacity-70 print:hidden" lang={uiLocale}>
          {emptyLabel}
        </p>
      ) : (
        <nav aria-label={document.labels.contents} className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{document.labels.contents}</h2>
          <ol className="flex list-none flex-col gap-1">
            {document.sections.map((section) => (
              <li key={section.id} className={["", "ps-6", "ps-12"][section.level - 1]}>
                <a href={`#section-${section.id}`} className="underline underline-offset-4 print:no-underline">
                  {section.number} {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {document.sections.map((section) => {
        const Heading = (["h2", "h3", "h4"] as const)[section.level - 1] ?? "h2";
        return (
          <section key={section.id} id={`section-${section.id}`} className="flex flex-col gap-3">
            <Heading className={HEADING[section.level - 1]}>
              {section.number} {section.title}
            </Heading>
            {section.paragraphs.map((lines, index) => (
              <p key={index} className="text-justify leading-relaxed">
                {lines.map((line, lineIndex) => (
                  <span key={lineIndex}>
                    {lineIndex > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </p>
            ))}
            {section.citations.length > 0 ? (
              <p className="text-sm opacity-80" data-testid="section-cited">
                {document.labels.cited} {section.citations.join(" ; ")}
              </p>
            ) : null}
          </section>
        );
      })}

      {document.references.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{document.labels.references}</h2>
          {document.references.map((segments, index) => (
            <p key={index} data-testid="document-reference" className="ps-8 -indent-8 break-words">
              {segments.map((segment, segmentIndex) =>
                segment.italic ? (
                  <em key={segmentIndex}>{segment.text}</em>
                ) : (
                  <span key={segmentIndex}>{segment.text}</span>
                ),
              )}
            </p>
          ))}
        </section>
      ) : null}
    </article>
  );
}
