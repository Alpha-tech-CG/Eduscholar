import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.tsx"],
    rules: {
      // ADR-0005 : aucun texte d'interface en dur, tout passe par les catalogues de messages.
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, ignoreProps: true, allowedStrings: [] },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Modèle de menaces M-17 : pas de HTML brut.
      "react/no-danger": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/^@supabase\\//]",
          message:
            "ADR-0007 : Supabase n'est importé que par les modules serveur dédiés.",
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^@supabase\\//]",
          message:
            "ADR-0007 : Supabase n'est importé que par les modules serveur dédiés.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                "Utiliser Link de @/i18n/navigation pour conserver la langue.",
            },
          ],
          patterns: [
            {
              group: ["@supabase/*"],
              message:
                "ADR-0007 : Supabase n'est importé que par les modules serveur dédiés.",
            },
          ],
        },
      ],
    },
  },
  {
    // Seuls modules autorisés à importer Supabase : ils sont réservés au serveur.
    files: ["src/lib/supabase/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                "Utiliser Link de @/i18n/navigation pour conserver la langue.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "src/lib/supabase/database.types.ts",
  ]),
]);

export default eslintConfig;
