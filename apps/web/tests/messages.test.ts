import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultLocale, locales } from "@/i18n/routing";

type Messages = { [key: string]: string | Messages };

function load(locale: string): Messages {
  const path = fileURLToPath(
    new URL(`../messages/${locale}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as Messages;
}

function flatten(messages: Messages, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      entries.set(path, value);
    } else {
      for (const [k, v] of flatten(value, path)) entries.set(k, v);
    }
  }
  return entries;
}

// ADR-0005 : une clé ajoutée l'est dans toutes les langues.
describe("catalogues de messages", () => {
  const reference = flatten(load(defaultLocale));

  it("le français et l'anglais sont les langues de lancement", () => {
    expect([...locales]).toEqual(["fr", "en"]);
  });

  for (const locale of locales) {
    it(`${locale} a exactement les mêmes clés que ${defaultLocale}`, () => {
      const keys = [...flatten(load(locale)).keys()].sort();
      expect(keys).toEqual([...reference.keys()].sort());
    });

    it(`${locale} n'a aucun message vide`, () => {
      const empty = [...flatten(load(locale))]
        .filter(([, value]) => value.trim() === "")
        .map(([key]) => key);
      expect(empty).toEqual([]);
    });
  }
});
