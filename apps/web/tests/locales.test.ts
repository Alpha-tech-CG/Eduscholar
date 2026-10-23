import { describe, expect, it, vi } from "vitest";
import {
  isLocale,
  isPreferenceLocale,
  labelFallbacks,
  LOCALE_PREFIX,
  locales,
  preferenceLocales,
} from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/redirect";
import { DOCUMENT_LOCALES, isDocumentLocale } from "@/lib/projects/bibliography";
import { documentLocale } from "@/lib/projects/document-loader";
import { referenceLabel } from "@/lib/reference/data";

// Modules réservés au serveur : seules leurs fonctions pures sont testées ici.
vi.mock("server-only", () => ({}));

describe("langues de l'interface", () => {
  it("une seule liste, dont dérivent les autres", () => {
    expect([...locales]).toEqual(["fr", "en", "pt"]);
    expect([...preferenceLocales]).toEqual([...locales]);
    for (const locale of locales) {
      expect(isLocale(locale)).toBe(true);
      expect(isPreferenceLocale(locale)).toBe(true);
    }
    for (const value of ["es", "FR", "", "fr-FR", undefined, 1]) expect(isLocale(value)).toBe(false);
  });

  it("le préfixe de langue reconnaît chaque langue, et rien d'autre", () => {
    for (const locale of locales) {
      expect(LOCALE_PREFIX.test(`/${locale}`)).toBe(true);
      expect(LOCALE_PREFIX.test(`/${locale}/search`)).toBe(true);
    }
    expect(LOCALE_PREFIX.test("/ptx/search")).toBe(false);
    expect(LOCALE_PREFIX.test("/es/search")).toBe(false);
  });

  it("l'adresse de retour perd son préfixe, portugais compris", () => {
    expect(safeNextPath("/pt/account")).toBe("/account");
    expect(safeNextPath("/pt")).toBe("/");
    expect(safeNextPath("/pt//exemple.invalid")).toBe("/exemple.invalid");
    expect(safeNextPath("/pt/en/fr/search?q=1")).toBe("/search?q=1");
  });
});

describe("libellés des référentiels", () => {
  const both = { fr: "Informatique", en: "Computer science" };

  it("la langue demandée d'abord, puis l'anglais, puis le français", () => {
    expect(labelFallbacks("pt")).toEqual(["pt", "en", "fr"]);
    expect(labelFallbacks("fr")).toEqual(["fr", "en"]);
    expect(referenceLabel(both, "fr")).toBe("Informatique");
    expect(referenceLabel(both, "en")).toBe("Computer science");
    expect(referenceLabel(both, "pt")).toBe("Computer science");
    expect(referenceLabel({ ...both, pt: "Informática" }, "pt")).toBe("Informática");
    expect(referenceLabel({ fr: "Informatique" }, "pt")).toBe("Informatique");
    expect(referenceLabel({ en: "", fr: "Informatique" }, "pt")).toBe("Informatique");
    expect(referenceLabel(null, "pt")).toBe("");
  });
});

describe("langue d'un document", () => {
  it("un mémoire se met en forme en français ou en anglais, quelle que soit l'interface", () => {
    expect([...DOCUMENT_LOCALES]).toEqual(["fr", "en"]);
    expect(isDocumentLocale("pt")).toBe(false);
    expect(documentLocale("en", "pt")).toBe("en");
    expect(documentLocale(undefined, "en")).toBe("en");
    // Interface en portugais, rien de demandé : la première langue de document.
    expect(documentLocale(undefined, "pt")).toBe("fr");
    expect(documentLocale(["en"], "fr")).toBe("en");
    expect(documentLocale("pt", "fr")).toBe("fr");
  });
});
