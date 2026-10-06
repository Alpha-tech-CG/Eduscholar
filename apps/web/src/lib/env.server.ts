import "server-only";
import { z } from "zod";

// Seul module qui lit les variables d'environnement serveur (docs/environment.md).
// La lecture est paresseuse : le build ne dépend d'aucune valeur.

const CROSSREF_OFFICIAL_URL = "https://api.crossref.org";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  APP_URL: z.url(),
  // Connecteur Crossref. Seule l'API officielle est admise ; un serveur local
  // de test ne la remplace que si CROSSREF_TEST_STUB vaut « 1 », jamais sur Vercel.
  CROSSREF_API_URL: z
    .string()
    .refine(
      (value) =>
        value === CROSSREF_OFFICIAL_URL ||
        (/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(value) &&
          process.env.CROSSREF_TEST_STUB === "1" &&
          !process.env.VERCEL),
    )
    .default(CROSSREF_OFFICIAL_URL),
  // Adresse de contact transmise à Crossref (accès « poli »). Facultative.
  CROSSREF_MAILTO: z.email().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = schema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    APP_URL: process.env.APP_URL,
    CROSSREF_API_URL: process.env.CROSSREF_API_URL || undefined,
    CROSSREF_MAILTO: process.env.CROSSREF_MAILTO || undefined,
  });

  if (!parsed.success) {
    // Les noms seulement : jamais les valeurs.
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Variables d'environnement serveur absentes ou invalides : ${names}`);
  }

  cached = parsed.data;
  return cached;
}
