import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { fillLegalText, isLegalPage, legalDocument } from "@/content/legal";
import type { LegalBlock } from "@/content/legal/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/legal/[page]">): Promise<Metadata> {
  const { page } = await params;
  if (!isLegalPage(page)) return {};
  const t = await getTranslations("Legal");
  // Page publique, sans session : elle s'indexe.
  return { title: t(`titles.${page}`) };
}

/** Un texte du document, les informations à fournir remplacées, celles qui manquent bien visibles. */
function Filled({ text }: { text: string }) {
  return (
    <>
      {fillLegalText(text).map((part, index) =>
        part.missing ? (
          <mark key={index} data-testid="legal-missing" className="rounded bg-yellow-200 px-1 text-black">
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "paragraph") {
    return (
      <p>
        <Filled text={block.text} />
      </p>
    );
  }
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List className={block.ordered ? "list-decimal ps-6" : "list-disc ps-6"}>
        {block.items.map((item) => (
          <li key={item}>
            <Filled text={item} />
          </li>
        ))}
      </List>
    );
  }
  return (
    // Un tableau défile dans son propre conteneur : la page, elle, ne défile pas de côté.
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{block.caption}</caption>
        <thead>
          <tr className="border-b border-foreground/20">
            {block.head.map((cell) => (
              <th key={cell} scope="col" className="py-2 pe-4 align-top font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join("|")} className="border-b border-foreground/10">
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row" className="py-2 pe-4 align-top font-normal">
                    <Filled text={cell} />
                  </th>
                ) : (
                  <td key={index} className="py-2 pe-4 align-top">
                    <Filled text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pages juridiques provisoires. Le texte de fond n'existe qu'en français : il
 * est affiché tel quel, marqué `lang="fr"`, avec, dans la langue de
 * l'interface, le titre, le bandeau « version provisoire » et, hors du
 * français, la phrase qui dit pourquoi le texte n'est pas traduit.
 */
export default async function LegalPage({ params }: PageProps<"/[locale]/legal/[page]">) {
  const { page } = await params;
  if (!isLegalPage(page)) notFound();

  const [t, locale, format] = await Promise.all([getTranslations("Legal"), getLocale(), getFormatter()]);
  const document = legalDocument(page);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t(`titles.${page}`)}</h1>
        <p
          role="note"
          data-testid="legal-provisional"
          className="rounded border-2 border-foreground/60 p-3 font-medium"
        >
          {t("provisional")}
        </p>
        {locale === "fr" ? null : (
          <p data-testid="legal-french-only" className="text-sm">
            {t("frenchOnly")}
          </p>
        )}
        <p className="text-sm opacity-70">
          {t("updated", { date: format.dateTime(new Date(`${document.updated}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" }) })}
        </p>
      </header>

      <div lang="fr" className="flex flex-col gap-6" data-testid="legal-body">
        {locale === "fr" ? null : <p className="text-lg font-semibold">{document.title}</p>}
        {document.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            {section.blocks.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
