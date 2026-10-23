import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fillLegalText, LEGAL_PAGES, legalDocument, MISSING_VALUE, referencedEntityKeys } from "@/content/legal";
import { assertLegalEntityComplete, missingLegalValues } from "@/content/legal/check";
import { LEGAL_ENTITY } from "@/content/legal/entity";
import type { LegalDocument } from "@/content/legal/types";
import { locales } from "@/i18n/routing";
import { signUpMode } from "@/lib/auth/signup-mode";

const complete = Object.fromEntries(Object.keys(LEGAL_ENTITY).map((key) => [key, `valeur de ${key}`]));

function texts(document: LegalDocument): string[] {
  return [
    document.title,
    ...document.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.kind === "paragraph" ? [block.text] : block.kind === "list" ? block.items : [block.caption, ...block.head, ...block.rows.flat()],
      ),
    ]),
  ];
}

describe("contrôle du build de production", () => {
  it("relève les informations vides", () => {
    expect(missingLegalValues({ a: "", b: "  ", c: "x" })).toEqual(["a", "b"]);
    expect(missingLegalValues(complete)).toEqual([]);
  });

  it("fait échouer la production Vercel tant qu'une information manque", () => {
    expect(() => assertLegalEntityComplete({ VERCEL_ENV: "production" }, { ...complete, controllerName: "" })).toThrow(
      /controllerName/,
    );
    expect(() => assertLegalEntityComplete({ VERCEL_ENV: "production" }, LEGAL_ENTITY)).toThrow(/entity\.ts/);
  });

  it("laisse passer la production complète, et tout autre environnement", () => {
    expect(() => assertLegalEntityComplete({ VERCEL_ENV: "production" }, complete)).not.toThrow();
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { VERCEL: "1" }, { NODE_ENV: "production" }]) {
      expect(() => assertLegalEntityComplete(env, LEGAL_ENTITY)).not.toThrow();
    }
  });

  it("le contrôle est bien appelé par la configuration du build", () => {
    const config = readFileSync(fileURLToPath(new URL("../next.config.ts", import.meta.url)), "utf8");
    expect(config).toMatch(/assertLegalEntityComplete\(process\.env, LEGAL_ENTITY\)/);
  });
});

describe("informations de l'entité responsable", () => {
  it("chaque information citée par une page existe, et chacune est citée", () => {
    expect(referencedEntityKeys()).toEqual(Object.keys(LEGAL_ENTITY).sort());
  });

  it("chaque clé est commentée dans entity.ts", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/content/legal/entity.ts", import.meta.url)), "utf8");
    for (const key of Object.keys(LEGAL_ENTITY)) {
      expect(source, key).toMatch(new RegExp(`/\\*\\*[^*]+\\*/\\s*\\n\\s*${key}:`));
    }
  });

  it("une information vide s'affiche « à compléter », une information connue s'affiche telle quelle", () => {
    expect(fillLegalText("Contact : {{dataProtectionContact}}.", { dataProtectionContact: "" })).toEqual([
      { text: "Contact : ", missing: false },
      { text: MISSING_VALUE, missing: true },
      { text: ".", missing: false },
    ]);
    expect(fillLegalText("{{a}} et {{b}}", { a: "A", b: " " }).map(({ text }) => text)).toEqual(["A", " et ", MISSING_VALUE]);
    expect(fillLegalText("{{inconnue}}", {})).toEqual([{ text: MISSING_VALUE, missing: true }]);
    expect(fillLegalText("Sans information.")).toEqual([{ text: "Sans information.", missing: false }]);
  });
});

describe("pages juridiques", () => {
  it("les quatre pages demandées", () => {
    expect([...LEGAL_PAGES]).toEqual(["privacy", "content", "ai", "minors"]);
  });

  for (const page of LEGAL_PAGES) {
    const document = legalDocument(page);

    it(`${page} : un titre, une date, des sections non vides`, () => {
      expect(document.title.trim()).not.toBe("");
      expect(document.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.sections.length).toBeGreaterThan(2);
      expect(texts(document).filter((text) => text.trim() === "")).toEqual([]);
    });

    it(`${page} : aucune mention de travail publiée`, () => {
      const published = texts(document).join("\n");
      // Ni marqueur à compléter, ni note au juriste, ni en-tête de brouillon, ni renvoi à un fichier interne.
      expect(published).not.toMatch(/\[À |À COMPLÉTER|À CONFIRMER|À CHOISIR|À PRÉCISER|À TRAITER|À DÉFINIR|À DÉCIDER|À ALIGNER|À NÉGOCIER|À APPRÉCIER/);
      expect(published).not.toMatch(/BROUILLON|Statut :|Tâche :|Références :|juriste|\.md\b|`/);
      // Une information à fournir passe par entity.ts, jamais écrite en dur.
      expect(published).not.toMatch(/\[à compléter\]/i);
    });
  }

  it("chaque page a un titre et un lien dans les trois langues", () => {
    for (const locale of locales) {
      const messages = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url)), "utf8"),
      ) as { Legal: { titles: Record<string, string>; links: Record<string, string>; provisional: string; frenchOnly: string } };
      for (const page of LEGAL_PAGES) {
        expect(messages.Legal.titles[page], `${locale} ${page}`).toBeTruthy();
        expect(messages.Legal.links[page], `${locale} ${page}`).toBeTruthy();
      }
      expect(messages.Legal.provisional).toBeTruthy();
      expect(messages.Legal.frenchOnly).toBeTruthy();
    }
  });

  it("la politique de confidentialité cite les services tiers ajoutés", () => {
    const published = texts(legalDocument("privacy")).join("\n");
    for (const name of ["Cloudflare (Turnstile)", "Have I Been Pwned", "Vercel", "Supabase", "Union européenne (Paris)", "es-device", "{{mailProvider}}"]) {
      expect(published, name).toContain(name);
    }
  });
});

describe("mode de la page d'inscription", () => {
  it("ouverte par défaut, fermée sur demande ou sur une valeur inconnue", () => {
    expect(signUpMode(undefined)).toBe("open");
    expect(signUpMode("")).toBe("open");
    expect(signUpMode("  ")).toBe("open");
    expect(signUpMode("open")).toBe("open");
    expect(signUpMode("invite_only")).toBe("invite_only");
    expect(signUpMode(" invite_only ")).toBe("invite_only");
    for (const value of ["invite-only", "closed", "OPEN", "true"]) expect(signUpMode(value)).toBe("invite_only");
  });
});
