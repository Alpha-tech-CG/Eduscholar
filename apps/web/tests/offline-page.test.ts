import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { locales } from "@/i18n/routing";
import { offlinePageCsp, renderOfflinePage } from "@/lib/offline/offline-page";

const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const messages = (locale: string) =>
  JSON.parse(readFileSync(fromRoot(`messages/${locale}.json`), "utf8")) as {
    Offline: { title: string; description: string; privacy: string; retry: string };
  };

// ADR-0012 : page servie par le service worker quand le réseau manque.
describe("page hors ligne", () => {
  const texts = locales.map((locale) => ({ locale, ...messages(locale).Offline }));
  const html = renderOfflinePage(texts);

  it("porte le texte de chaque langue, sous son attribut de langue", () => {
    for (const { locale, title, retry } of texts) {
      expect(html).toContain(`<section lang="${locale}"><h1>${title}</h1>`);
      expect(html).toContain(`>${retry}</a>`);
    }
  });

  it("ne contient ni script, ni ressource externe, ni formulaire", () => {
    expect(html).not.toMatch(/<script|<link|<img|<form|<iframe|https?:|\son[a-z]+=/i);
  });

  it("n'admet que sa propre feuille de style, par son empreinte", () => {
    const style = /<style>([^<]*)<\/style>/.exec(html)?.[1] ?? "";
    expect(style).not.toBe("");
    const hash = createHash("sha256").update(style).digest("base64");
    const csp = offlinePageCsp();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`style-src 'sha256-${hash}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe|script-src|\*/);
  });

  it("échappe les textes", () => {
    const hostile = renderOfflinePage([
      { locale: 'fr"><script>', title: "<b>&", description: "'", privacy: '"', retry: "</a>" },
    ]);
    expect(hostile).not.toContain("<script>");
    expect(hostile).not.toContain("<b>");
    expect(hostile).toContain("&lt;b&gt;&amp;");
  });
});

describe("manifeste de l'application", () => {
  const data = manifest();

  it("rend l'application installable", () => {
    expect(data.name).toBeTruthy();
    expect(data.short_name).toBeTruthy();
    expect(data.start_url).toBe("/");
    expect(data.scope).toBe("/");
    expect(data.display).toBe("standalone");
    expect(data.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(data.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("propose des icônes PNG de 192 et 512 points, et une icône « maskable »", () => {
    const icons = data.icons ?? [];
    const png = icons.filter((icon) => icon.type === "image/png").map((icon) => icon.sizes);
    expect(png).toContain("192x192");
    expect(png).toContain("512x512");
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("ne désigne que des fichiers présents, de la taille annoncée", () => {
    for (const icon of data.icons ?? []) {
      const path = fromRoot(`public${icon.src}`);
      expect(existsSync(path), icon.src).toBe(true);
      if (icon.type !== "image/png") continue;
      // En-tête PNG : largeur et hauteur aux octets 16 à 23.
      const file = readFileSync(path);
      expect(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
});
