import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTranslator } from "next-intl";
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

/** Arguments ICU d'un message : ce qui est à remplacer, pas le texte des branches de pluriel. */
function argumentsOf(message: string): string[] {
  return [
    ...message.matchAll(/(?<!(?:=\d+|zero|one|two|few|many|other)\s*)\{(\w+)\s*[,}]/g),
  ]
    .map((match) => match[1] ?? "")
    .sort();
}

// ADR-0005 : une clé ajoutée l'est dans toutes les langues.
describe("catalogues de messages", () => {
  const reference = flatten(load(defaultLocale));

  it("le français, l'anglais et le portugais sont les langues de l'interface", () => {
    expect([...locales]).toEqual(["fr", "en", "pt"]);
  });

  for (const locale of locales) {
    const catalogue = flatten(load(locale));

    it(`${locale} a exactement les mêmes clés que ${defaultLocale}`, () => {
      expect([...catalogue.keys()].sort()).toEqual([...reference.keys()].sort());
    });

    it(`${locale} n'a aucun message vide`, () => {
      const empty = [...catalogue].filter(([, value]) => value.trim() === "").map(([key]) => key);
      expect(empty).toEqual([]);
    });

    it(`${locale} a les mêmes arguments que ${defaultLocale} dans chaque message`, () => {
      const different = [...reference]
        .filter(([key, value]) => argumentsOf(value).join() !== argumentsOf(catalogue.get(key) ?? "").join())
        .map(([key]) => key);
      expect(different).toEqual([]);
    });

    it(`${locale} : chaque message se compile et se met en forme, pluriels et nombres compris`, () => {
      const errors: string[] = [];
      const t = createTranslator({
        locale,
        messages: load(locale),
        onError: (error) => errors.push(error.message),
        getMessageFallback: ({ key }) => key,
      });
      for (const [key, value] of catalogue) {
        // Des valeurs d'exemple pour chaque argument : nombres pour les pluriels, texte sinon.
        const values = Object.fromEntries(
          argumentsOf(value).map((name) => [name, /count|days|members|admins|sections|sources|citations|tasks|flagged|page|pages|number|percent|total|year/.test(name) ? 2 : "x"]),
        );
        const out = (t as unknown as (key: string, values: Record<string, unknown>) => string)(key, values);
        if (typeof out !== "string" || out.includes("{")) errors.push(`${key} : ${String(out)}`);
      }
      expect(errors).toEqual([]);
    });
  }

  it("le portugais n'est pas une copie du français ni de l'anglais", () => {
    const pt = flatten(load("pt"));
    const en = flatten(load("en"));
    // Un texte fait seulement d'arguments et de ponctuation (« {label} ({code}) »)
    // est le même partout ; tout autre texte de plus d'un mot doit être traduit.
    const wordy = (value: string) => /\p{L}{3,}/u.test(value.replace(/\{\w+\}/g, ""));
    const same = [...reference].filter(
      ([key, value]) =>
        wordy(value) && value.includes(" ") && (pt.get(key) === value || pt.get(key) === en.get(key)),
    );
    expect(same.map(([key]) => key)).toEqual([]);
  });
});
