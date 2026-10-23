import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { HELP_TOPICS, helpContent } from "@/content/help";

export async function generateMetadata(): Promise<Metadata> {
  const content = helpContent(await getLocale());
  // Page publique, sans session : elle s'indexe.
  return { title: content.index.title, description: content.index.intro };
}

/** Index de l'aide : publique, la même pour tous, sans lecture de compte. */
export default async function HelpPage() {
  const content = helpContent(await getLocale());

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{content.index.title}</h1>
        <p className="opacity-80">{content.index.intro}</p>
      </header>

      <section aria-labelledby="help-topics" className="flex flex-col gap-3">
        <h2 id="help-topics" className="text-lg font-semibold">
          {content.index.topicsHeading}
        </h2>
        <ul className="flex flex-col gap-3">
          {HELP_TOPICS.map((topic) => (
            <li key={topic} data-testid="help-topic" className="flex flex-col gap-1">
              <Link href={`/help/${topic}`} className="font-medium underline underline-offset-4">
                {content.topics[topic].title}
              </Link>
              <p className="text-sm opacity-80">{content.topics[topic].summary}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm opacity-70">{content.index.note}</p>
    </article>
  );
}
