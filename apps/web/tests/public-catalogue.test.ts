import { describe, expect, it } from "vitest";
import {
  alternateLanguages,
  localizedUrl,
  parseHomeSections,
  parsePublicResource,
  parsePublicSearch,
  parseSitemapResources,
  resourceDescription,
  resourceJsonLd,
  serializeJsonLd,
} from "@/lib/catalogue/public-resource";
import { parsePublicSearchParams, toPublicSearchParams } from "@/lib/catalogue/search";
import {
  buildRobots,
  buildSitemap,
  SITEMAP_REVALIDATE_SECONDS,
  STATIC_PUBLIC_PATHS,
} from "@/lib/seo/public-pages";
import { readFileSync } from "node:fs";

const ID = "83000000-0000-0000-0000-000000000001";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  type_code: "article",
  title: "Réseaux du Sahel",
  abstract: "Un résumé.",
  authors: ["Awa Diop", "Kofi Mensah"],
  institution_name: null,
  publication_year: 2024,
  thesis_degree: null,
  language_code: "fr",
  country_code: "SN",
  program_code: "computer_science",
  level_codes: ["bachelor_3"],
  subject_codes: [],
  tags: ["réseaux"],
  doi: "10.1234/abc",
  official_url: "https://exemple.invalid/p1",
  access_status: "open_access",
  license_code: "cc-by-4.0",
  source_kind: "connector",
  source_name: "crossref",
  last_verified_at: "2026-10-01T00:00:00Z",
  published_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
  verified_institution: false,
  ...overrides,
});

describe("lecture des réponses du catalogue public", () => {
  it("lit une fiche et ignore toute clé inattendue", () => {
    const resource = parsePublicResource(row({ submitted_by: "x", organization_id: "y" }));
    expect(resource?.title).toBe("Réseaux du Sahel");
    expect(resource).not.toHaveProperty("submitted_by");
    expect(resource).not.toHaveProperty("organization_id");
    expect(resource).not.toHaveProperty("submittedBy");
  });

  it("écarte une fiche mal formée plutôt que de l'afficher à moitié", () => {
    expect(parsePublicResource(null)).toBeNull();
    expect(parsePublicResource(row({ id: "pas-un-identifiant" }))).toBeNull();
    expect(parsePublicResource(row({ title: 42 }))).toBeNull();
  });

  it("une page de recherche garde les seules fiches bien formées", () => {
    const page = parsePublicSearch({ items: [row(), row({ id: 1 })], total: 2, capped: false });
    expect(page?.resources).toHaveLength(1);
    expect(page?.total).toBe(2);
    expect(parsePublicSearch({ items: [], total: -1, capped: false })).toBeNull();
    expect(parsePublicSearch("erreur")).toBeNull();
  });

  it("les sections de l'accueil sont vides si la réponse ne convient pas", () => {
    expect(parseHomeSections(null)).toEqual({ recent: [], popular: [], institutional: [] });
    expect(parseHomeSections({ recent: [row()], popular: "x" }).recent).toHaveLength(1);
  });

  it("le plan du site ne garde que l'identifiant et la date", () => {
    expect(parseSitemapResources([{ id: ID, updated_at: "2026-10-03T00:00:00Z", title: "x" }])).toEqual([
      { id: ID, updatedAt: "2026-10-03T00:00:00Z" },
    ]);
    expect(parseSitemapResources("x")).toEqual([]);
  });
});

describe("paramètres de la recherche sans compte", () => {
  const reference = {
    types: ["article"],
    languages: ["fr"],
    levels: ["bachelor_3"],
    programs: ["computer_science"],
    countries: ["SN"],
  };

  it("garde les filtres du référentiel et ignore les autres", () => {
    const filters = parsePublicSearchParams(
      { q: "  réseaux   sahel ", country: "SN", program: "inconnue", level: "bachelor_3", subject: "x" },
      reference,
    );
    expect(filters).toMatchObject({
      query: "réseaux sahel",
      countryCode: "SN",
      programCode: null,
      levelCode: "bachelor_3",
    });
    expect(filters).not.toHaveProperty("subjectCode");
  });

  it("reconstruit l'adresse d'une page", () => {
    const filters = parsePublicSearchParams({ q: "x", country: "SN", program: "computer_science" }, reference);
    expect(toPublicSearchParams(filters, 2)).toEqual({
      q: "x",
      country: "SN",
      program: "computer_science",
      page: "2",
    });
  });
});

describe("adresses des pages publiques", () => {
  it("préfixe chaque page par sa langue, sans double barre", () => {
    expect(localizedUrl("https://eduscholar.example/", "en", "/")).toBe("https://eduscholar.example/en");
    expect(localizedUrl("https://eduscholar.example", "pt", "/help")).toBe("https://eduscholar.example/pt/help");
  });

  it("donne les trois langues et la version par défaut", () => {
    expect(alternateLanguages("https://e.example", "/resources/1")).toEqual({
      fr: "https://e.example/fr/resources/1",
      en: "https://e.example/en/resources/1",
      pt: "https://e.example/pt/resources/1",
      "x-default": "https://e.example/fr/resources/1",
    });
  });

  it("le plan du site liste chaque page dans chaque langue", () => {
    const entries = buildSitemap("https://e.example", [{ id: ID, updatedAt: "2026-10-03T00:00:00Z" }]);
    expect(entries).toHaveLength((STATIC_PUBLIC_PATHS.length + 1) * 3);
    const resource = entries.filter((entry) => entry.url.endsWith(`/resources/${ID}`));
    expect(resource.map((entry) => entry.url)).toEqual([
      `https://e.example/fr/resources/${ID}`,
      `https://e.example/en/resources/${ID}`,
      `https://e.example/pt/resources/${ID}`,
    ]);
    expect(resource[0]?.lastModified).toBe("2026-10-03T00:00:00Z");
    expect(entries.some((entry) => /\/(fr|en|pt)\/(account|admin|search)(\/|$)/.test(entry.url))).toBe(false);
  });

  it("robots.txt ferme les espaces des comptes dans chaque langue", () => {
    const robots = buildRobots("https://e.example/");
    const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
    const disallow = rules?.disallow as string[];
    for (const path of ["/api/", "/fr/account", "/en/admin", "/pt/moderation", "/fr/projects", "/en/library", "/pt/search"]) {
      expect(disallow).toContain(path);
    }
    expect(disallow).not.toContain("/fr/resources");
    expect(robots.sitemap).toBe("https://e.example/sitemap.xml");
  });
});

describe("données structurées", () => {
  const resource = parsePublicResource(row())!;

  it("décrit la fiche sans rien inventer", () => {
    const data = resourceJsonLd(resource, "https://e.example/fr/resources/1");
    expect(data).toMatchObject({
      "@type": "ScholarlyArticle",
      name: "Réseaux du Sahel",
      datePublished: "2024",
      inLanguage: "fr",
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      identifier: { propertyID: "DOI", value: "10.1234/abc" },
    });
    expect(data.author).toEqual([
      { "@type": "Person", name: "Awa Diop" },
      { "@type": "Person", name: "Kofi Mensah" },
    ]);
  });

  it("omet ce que la fiche ne dit pas", () => {
    const bare = parsePublicResource(
      row({ doi: null, publication_year: null, authors: [], institution_name: null, license_code: "unknown", tags: [], type_code: "exercise", access_status: "paid" }),
    )!;
    const data = resourceJsonLd(bare, "https://e.example/fr/resources/1");
    expect(data["@type"]).toBe("CreativeWork");
    for (const key of ["identifier", "datePublished", "author", "license", "keywords"]) {
      expect(data, key).not.toHaveProperty(key);
    }
    expect(data.isAccessibleForFree).toBe(false);
  });

  it("aucun texte de fiche ne referme l'élément script", () => {
    const hostile = parsePublicResource(row({ title: "</script><script>alert(1)</script>&" }))!;
    const json = serializeJsonLd(resourceJsonLd(hostile, "https://e.example/fr/resources/1"));
    expect(json).not.toMatch(/[<>&]/);
    expect(JSON.parse(json).name).toBe("</script><script>alert(1)</script>&");
  });

  it("la description est courte, et tirée de la fiche", () => {
    const long = parsePublicResource(row({ abstract: "mot ".repeat(200) }))!;
    expect(Array.from(resourceDescription(long)).length).toBeLessThanOrEqual(200);
    const noAbstract = parsePublicResource(row({ abstract: null }))!;
    expect(resourceDescription(noAbstract)).toBe("Awa Diop, Kofi Mensah, 2024");
  });
});

describe("configuration du plan du site", () => {
  it("la liste des fiches est gardée quelques minutes, pas plus", () => {
    expect(Number.isInteger(SITEMAP_REVALIDATE_SECONDS)).toBe(true);
    expect(SITEMAP_REVALIDATE_SECONDS).toBeGreaterThanOrEqual(60);
    expect(SITEMAP_REVALIDATE_SECONDS).toBeLessThanOrEqual(900);
  });

  it("la route reste lue à la demande, et la lecture en base passe par le cache", () => {
    const route = readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    const queries = readFileSync(new URL("../src/lib/catalogue/public-queries.ts", import.meta.url), "utf8");
    expect(queries).toMatch(/unstable_cache\(/);
    expect(queries).toMatch(/revalidate: SITEMAP_REVALIDATE_SECONDS/);
  });
});
