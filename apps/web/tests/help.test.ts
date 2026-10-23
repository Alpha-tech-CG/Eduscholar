import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HELP_TOPICS, helpContent, isHelpTopic } from "@/content/help";
import type { HelpContent } from "@/content/help/types";
import { locales } from "@/i18n/routing";

const appDir = fileURLToPath(new URL("../src/app/[locale]/", import.meta.url));

/** Page de l'application que désigne un lien de l'aide, parmi les dossiers de routes (groupes compris). */
function pageExists(href: string): boolean {
  if (!href.startsWith("/") || href.includes("?") || href.includes("#") || href.includes("..")) return false;
  const path = href.replace(/^\/|\/$/g, "");
  const help = /^help\/([a-z-]+)$/.exec(path);
  if (help) return isHelpTopic(help[1]) && existsSync(`${appDir}help/[topic]/page.tsx`);
  return [`${appDir}${path}/page.tsx`, `${appDir}(auth)/${path}/page.tsx`].some((file) => existsSync(file));
}

/** Tous les textes d'un contenu d'aide, avec leur chemin. */
function texts(content: HelpContent): [string, string][] {
  const out: [string, string][] = [
    ["index.title", content.index.title],
    ["index.intro", content.index.intro],
    ["index.topicsHeading", content.index.topicsHeading],
    ["index.note", content.index.note],
    ["backToIndex", content.backToIndex],
    ["relatedHeading", content.relatedHeading],
  ];
  for (const topic of HELP_TOPICS) {
    const page = content.topics[topic];
    out.push([`${topic}.title`, page.title], [`${topic}.summary`, page.summary]);
    page.sections.forEach((section, index) => {
      out.push([`${topic}.${index}.heading`, section.heading]);
      section.paragraphs.forEach((paragraph, p) => out.push([`${topic}.${index}.p${p}`, paragraph]));
      (section.links ?? []).forEach((link, l) => out.push([`${topic}.${index}.link${l}`, link.label]));
    });
  }
  return out;
}

const shape = (content: HelpContent) =>
  HELP_TOPICS.map((topic) => ({
    topic,
    sections: content.topics[topic].sections.map((section) => ({
      paragraphs: section.paragraphs.length,
      links: (section.links ?? []).map((link) => link.href),
    })),
  }));

describe("aide en ligne", () => {
  it("couvre au moins les sujets demandés", () => {
    expect([...HELP_TOPICS]).toEqual(["account", "search", "library", "project", "sharing", "offline", "data", "report"]);
  });

  for (const locale of locales) {
    const content = helpContent(locale);

    it(`${locale} : aucun texte vide`, () => {
      expect(texts(content).filter(([, value]) => value.trim() === "").map(([path]) => path)).toEqual([]);
    });

    it(`${locale} : chaque lien mène à une page de l'application`, () => {
      const links = HELP_TOPICS.flatMap((topic) =>
        content.topics[topic].sections.flatMap((section) => section.links ?? []),
      );
      expect(links.length).toBeGreaterThan(10);
      expect(links.filter((link) => !pageExists(link.href)).map((link) => link.href)).toEqual([]);
    });

    it(`${locale} : même découpage et mêmes liens que le français`, () => {
      expect(shape(content)).toEqual(shape(helpContent("fr")));
    });

    it(`${locale} : aucun texte ne porte de balise ni d'adresse externe`, () => {
      expect(texts(content).filter(([, value]) => /[<>]|https?:\/\//.test(value)).map(([path]) => path)).toEqual([]);
    });
  }

  it("les trois langues ne se recopient pas", () => {
    const [fr, en, pt] = locales.map((locale) => new Map(texts(helpContent(locale))));
    const copied = [...(fr ?? new Map<string, string>())].filter(
      ([path, value]) => value.includes(" ") && (en?.get(path) === value || pt?.get(path) === value),
    );
    expect(copied.map(([path]) => path)).toEqual([]);
  });

  it("le contrôle des liens refuse une page qui n'existe pas", () => {
    expect(pageExists("/search")).toBe(true);
    expect(pageExists("/sign-up")).toBe(true);
    expect(pageExists("/help/offline")).toBe(true);
    expect(pageExists("/help/inconnu")).toBe(false);
    expect(pageExists("/page-inexistante")).toBe(false);
    expect(pageExists("https://exemple.invalid/")).toBe(false);
    expect(pageExists("/search?q=x")).toBe(false);
  });
});
