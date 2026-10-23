import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { HelpLinks } from "@/components/help/help-links";
import { Link } from "@/i18n/navigation";
import { HELP_TOPICS, helpContent, isHelpTopic } from "@/content/help";

export async function generateMetadata({ params }: PageProps<"/[locale]/help/[topic]">): Promise<Metadata> {
  const { topic } = await params;
  if (!isHelpTopic(topic)) return {};
  const content = helpContent(await getLocale());
  return { title: content.topics[topic].title, description: content.topics[topic].summary };
}

/** Une page d'aide. Un sujet inconnu répond « introuvable ». */
export default async function HelpTopicPage({ params }: PageProps<"/[locale]/help/[topic]">) {
  const { topic } = await params;
  if (!isHelpTopic(topic)) notFound();

  const content = helpContent(await getLocale());
  const page = content.topics[topic];
  const others = HELP_TOPICS.filter((other) => other !== topic);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm">
          <Link href="/help" className="inline-block py-2 underline underline-offset-4">
            {content.backToIndex}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
        <p className="opacity-80">{page.summary}</p>
      </header>

      {page.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2" data-testid="help-section">
          <h2 className="text-lg font-semibold">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.links ? <HelpLinks links={section.links} /> : null}
        </section>
      ))}

      <nav aria-labelledby="help-related" className="flex flex-col gap-2 border-t border-foreground/20 pt-4">
        <h2 id="help-related" className="text-lg font-semibold">
          {content.relatedHeading}
        </h2>
        <ul className="flex flex-col gap-1">
          {others.map((other) => (
            <li key={other}>
              <Link href={`/help/${other}`} className="inline-block py-2 underline underline-offset-4">
                {content.topics[other].title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  );
}
