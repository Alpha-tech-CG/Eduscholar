import "server-only";
import { z } from "zod";

// Seul module qui lit les variables d'environnement serveur (docs/environment.md).
// La lecture est paresseuse : le build ne dépend d'aucune valeur.

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  APP_URL: z.url(),
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
  });

  if (!parsed.success) {
    // Les noms seulement : jamais les valeurs.
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Variables d'environnement serveur absentes ou invalides : ${names}`);
  }

  cached = parsed.data;
  return cached;
}
