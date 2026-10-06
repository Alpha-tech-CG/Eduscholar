import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://localhost:${port}`;
const crossrefStubPort = 3199;

// Les tests de bout en bout tournent contre le build de production, pour
// vérifier les en-têtes réellement servis, et contre l'instance Supabase locale.
// Ils sont lancés par « npm run test:e2e », qui fournit les variables locales ;
// le serveur démarré ci-dessous en hérite.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Une trace contient les cookies de session : jamais en CI.
  use: { baseURL, trace: process.env.CI ? "off" : "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    // Faux serveur Crossref : aucun test n'interroge la vraie source.
    {
      command: "node e2e/support/crossref-stub.mjs",
      url: `http://127.0.0.1:${crossrefStubPort}/health`,
      reuseExistingServer: !process.env.CI,
      env: { CROSSREF_STUB_PORT: String(crossrefStubPort) },
      timeout: 20_000,
    },
    {
      command: `npm run start -- --port ${port}`,
      url: `${baseURL}/fr`,
      reuseExistingServer: !process.env.CI,
      // En-tête de confiance du serveur de test : il tient lieu d'adresse du
      // client, comme le ferait le proxy de l'hébergeur.
      env: {
        ...(process.env as Record<string, string>),
        TRUSTED_CLIENT_IP_HEADER: "x-e2e-client-ip",
        CROSSREF_API_URL: `http://127.0.0.1:${crossrefStubPort}`,
        CROSSREF_TEST_STUB: "1",
      },
      timeout: 60_000,
    },
  ],
});
