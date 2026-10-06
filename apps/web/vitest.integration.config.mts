import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests d'intégration : ils appellent l'instance Supabase locale par son API,
// comme le ferait un client quelconque. À lancer par « npm run test:integration ».
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
