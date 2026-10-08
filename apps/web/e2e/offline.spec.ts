import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  signInThroughForm,
  sql,
  sqlValue,
  strongPassword,
  uniqueEmail,
} from "./support/auth";

// Mode faible connexion (ADR-0012) : application installable, service worker,
// page hors ligne, bandeau de connexion et reprise de l'éditeur de section.

// Une adresse de client propre à ce fichier : ses connexions ne pèsent pas sur
// la limite par adresse que se partagent les autres parcours.
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.21" } });

/** Attend que le service worker soit actif et qu'il contrôle la page. */
async function workerInControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
    );
  });
}

/** Tout ce que le navigateur garde pour l'origine, hors cookies. */
async function localData(page: Page) {
  return page.evaluate(async () => {
    const entries: { path: string; type: string; body: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const type = response?.headers.get("Content-Type") ?? "";
        entries.push({
          path: new URL(request.url).pathname + new URL(request.url).search,
          type,
          body: /html|json|text/.test(type) ? ((await response?.text()) ?? "") : "",
        });
      }
    }
    return {
      entries,
      localStorage: Object.keys(localStorage),
      sessionStorage: Object.keys(sessionStorage),
      databases: (await indexedDB.databases()).map((database) => database.name),
    };
  });
}

async function signIn(page: Page, label: string) {
  const email = uniqueEmail(label);
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return { id, email };
}

/** Un projet et une section, créés directement en base pour le compte donné. */
function seedSection(ownerId: string) {
  const projectId = randomUUID();
  const sectionId = randomUUID();
  sql(`
    insert into public.research_projects (id, owner_id, title) values ('${projectId}', '${ownerId}', 'Mémoire hors ligne');
    insert into public.thesis_sections (id, project_id, position, level, title) values ('${sectionId}', '${projectId}', 1, 1, 'Introduction')
  `);
  const stored = () =>
    sqlValue(`select coalesce(body, '') from public.thesis_sections where id = '${sectionId}'`);
  return { url: `/fr/projects/${projectId}/outline/${sectionId}`, sectionId, stored };
}

test.describe("application installable", () => {
  test("le manifeste et le service worker sont servis, sans erreur de politique de contenu", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/fr");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);

    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    const data = (await manifest.json()) as {
      display: string;
      start_url: string;
      icons: { src: string; purpose: string; type: string }[];
    };
    expect(data.display).toBe("standalone");
    expect(data.start_url).toBe("/");
    expect(data.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of data.icons) {
      const file = await request.get(icon.src);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"], icon.src).toContain(icon.type);
    }

    // Le worker n'est ni redirigé par langue, ni gardé par un cache.
    const worker = await request.get("/sw.js", { maxRedirects: 0 });
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("application/javascript");
    expect(worker.headers()["cache-control"]).toContain("no-store");
    expect(worker.headers()["content-security-policy"]).toBe(
      "default-src 'none'; connect-src 'self'; frame-ancestors 'none'",
    );
    expect(worker.headers()["set-cookie"]).toBeUndefined();

    await workerInControl(page);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js$/);
    expect(errors.filter((error) => error.includes("Content Security Policy"))).toEqual([]);
  });

  test("la page hors ligne est publique, bilingue, sans script ni cookie", async ({ request }) => {
    const response = await request.get("/offline.html", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).not.toContain("script-src");
    expect(headers["set-cookie"]).toBeUndefined();
    expect(headers["x-frame-options"]).toBe("DENY");
    const html = await response.text();
    expect(html).toContain("Vous êtes hors ligne");
    expect(html).toContain("You are offline");
    expect(html).not.toContain("<script");
  });
});

test.describe("hors ligne", () => {
  test("le bandeau apparaît à la coupure et disparaît au retour du réseau", async ({ page, context }) => {
    await page.goto("/fr");
    const banner = page.getByTestId("connection-status");
    await expect(banner).toHaveAttribute("role", "status");
    await expect(banner).toBeEmpty();

    await context.setOffline(true);
    await expect(banner).toHaveText(/^Vous êtes hors ligne\./);
    await expect(banner).toBeVisible();

    await context.setOffline(false);
    await expect(banner).toBeEmpty();

    await page.goto("/en");
    await context.setOffline(true);
    await expect(page.getByTestId("connection-status")).toHaveText(/^You are offline\./);
  });

  test("une page demandée sans réseau affiche la page hors ligne, puis la vraie page au retour", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/fr");
    await workerInControl(page);

    await context.setOffline(true);
    const response = await page.goto("/fr/sign-in");
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    // L'adresse demandée est conservée : « Réessayer » la redemande.
    await expect(page).toHaveURL(/\/fr\/sign-in$/);
    // Petit écran : pas de défilement horizontal, action d'au moins 44 points.
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    const retry = page.getByRole("link", { name: "Réessayer" });
    expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    // Toujours hors ligne : réessayer ne casse rien.
    await retry.click();
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toBeVisible();

    await context.setOffline(false);
    await page.getByRole("link", { name: "Réessayer" }).click();
    await expect(page.getByLabel("Adresse électronique")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toHaveCount(0);
  });

  test("aucune page du compte n'est gardée : ni pendant la session, ni après la déconnexion", async ({
    page,
    context,
  }) => {
    const { email } = await signIn(page, "horsligne");
    await workerInControl(page);
    // Plusieurs pages privées vues sous le contrôle du worker.
    await page.goto("/fr/account");
    await expect(page.getByTestId("account-email")).toHaveText(email);
    await page.goto("/fr/projects");
    await page.goto("/fr/account");
    await expect(page.getByTestId("account-email")).toHaveText(email);

    const allowed = (path: string) =>
      path.startsWith("/_next/static/") ||
      path.startsWith("/icons/") ||
      path === "/offline.html" ||
      path === "/manifest.webmanifest";
    const inspect = async () => {
      const data = await localData(page);
      expect(data.entries.length).toBeGreaterThan(0);
      expect(data.entries.filter((entry) => !allowed(entry.path)).map((entry) => entry.path)).toEqual([]);
      // La seule page gardée est la page hors ligne.
      expect(
        data.entries.filter((entry) => entry.type.includes("html")).map((entry) => entry.path),
      ).toEqual(["/offline.html"]);
      expect(data.entries.filter((entry) => entry.body.includes(email))).toEqual([]);
      expect(data.localStorage).toEqual([]);
      expect(data.sessionStorage).toEqual([]);
      expect(data.databases).toEqual([]);
    };
    await inspect();

    // Pendant la session, sans réseau : la page du compte n'est pas rendue.
    await context.setOffline(true);
    await page.goto("/fr/account");
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(email);
    await context.setOffline(false);

    await page.goto("/fr/account");
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/fr$/);
    await inspect();

    // Après la déconnexion, sans réseau : toujours rien du compte.
    await context.setOffline(true);
    await page.goto("/fr/account");
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(email);
    await page.goBack();
    await expect(page.locator("body")).not.toContainText(email);

    // Et avec le réseau : la connexion est redemandée.
    await context.setOffline(false);
    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Faccount/);
  });
});

test.describe("éditeur de section sans réseau", () => {
  test.setTimeout(120_000);

  test("le texte reste à l'écran, l'état le dit, et l'envoi reprend au retour du réseau", async ({
    page,
    context,
  }) => {
    const { id } = await signIn(page, "reprise");
    const section = seedSection(id);
    await page.goto(section.url);
    const body = page.getByLabel("Texte de la section");
    const status = page.getByTestId("save-status");
    const notice = page.getByTestId("network-alert");

    await body.click();
    await page.keyboard.type("Premier paragraphe.");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(status).toContainText("Enregistré à");
    expect(section.stored()).toBe("Premier paragraphe.");

    // --- Coupure ---------------------------------------------------------------
    await context.setOffline(true);
    await body.press("Control+End");
    await page.keyboard.type(" Écrit sans réseau.");
    await expect(status).toHaveText("Non enregistré — hors ligne.", { timeout: 20_000 });
    await expect(notice).toContainText("Gardez cet onglet ouvert");
    await expect(page.getByTestId("connection-status")).toHaveText(/^Vous êtes hors ligne\./);
    // La frappe continue ; rien n'est perdu ni envoyé, l'avis ne se répète pas.
    await page.keyboard.type(" Encore une phrase.");
    const text = "Premier paragraphe. Écrit sans réseau. Encore une phrase.";
    await expect(body).toHaveValue(text);
    await expect(status).toHaveText("Non enregistré — hors ligne.");
    await expect(notice).toHaveCount(1);
    expect(section.stored()).toBe("Premier paragraphe.");

    // Le texte n'est écrit dans aucun stockage du navigateur.
    const data = await localData(page);
    expect(data.localStorage).toEqual([]);
    expect(data.sessionStorage).toEqual([]);
    expect(data.databases).toEqual([]);
    expect(data.entries.filter((entry) => entry.body.includes("sans réseau"))).toEqual([]);

    // Quitter la page : le navigateur demande confirmation ; refusée, le texte reste.
    const asked = page.waitForEvent("dialog");
    void page.evaluate(() => window.location.reload()).catch(() => undefined);
    const dialog = await asked;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await expect(body).toHaveValue(text);

    // --- Retour du réseau : l'envoi part seul, sans attendre le délai en cours ---
    await context.setOffline(false);
    await expect(status).toContainText("Enregistré à", { timeout: 15_000 });
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId("connection-status")).toBeEmpty();
    await expect(page.getByTestId("conflict")).toHaveCount(0);
    expect(section.stored()).toBe(text);
    await page.reload();
    await expect(body).toHaveValue(text);
  });

  test("une coupure pendant l'écriture n'écrase rien et ne crée pas de faux conflit", async ({ page }) => {
    const { id } = await signIn(page, "coupure");
    const section = seedSection(id);
    await page.goto(section.url);
    const body = page.getByLabel("Texte de la section");
    const status = page.getByTestId("save-status");

    // L'enregistrement atteint le serveur, mais sa réponse se perd en route.
    let cut = 0;
    await page.route("**/outline/**", async (route) => {
      if (route.request().method() !== "POST" || cut > 0) return route.fallback();
      cut += 1;
      await route.fetch();
      await route.abort("connectionreset");
    });

    await body.click();
    await page.keyboard.type("Texte envoyé pendant la coupure.");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(status).toHaveText("Non enregistré — serveur injoignable.");
    await expect(page.getByTestId("network-alert")).toBeVisible();
    await expect(body).toHaveValue("Texte envoyé pendant la coupure.");
    expect(cut).toBe(1);
    // Le serveur, lui, a bien enregistré.
    expect(section.stored()).toBe("Texte envoyé pendant la coupure.");

    // L'essai suivant part seul : la version du serveur est reconnue comme la sienne.
    await expect(status).toContainText("Enregistré à", { timeout: 30_000 });
    await expect(page.getByTestId("conflict")).toHaveCount(0);
    await expect(page.getByTestId("network-alert")).toHaveCount(0);
    expect(section.stored()).toBe("Texte envoyé pendant la coupure.");
  });

  test("au retour du réseau, une version écrite sur un autre appareil n'est pas écrasée", async ({
    page,
    context,
  }) => {
    const { id } = await signIn(page, "conflit");
    const section = seedSection(id);
    await page.goto(section.url);
    const body = page.getByLabel("Texte de la section");

    await context.setOffline(true);
    await body.click();
    await page.keyboard.type("Version écrite hors ligne.");
    await expect(page.getByTestId("save-status")).toHaveText("Non enregistré — hors ligne.", {
      timeout: 20_000,
    });

    // Pendant ce temps, un autre appareil enregistre la même section.
    sql(
      `update public.thesis_sections set body = 'Version de l''autre appareil.' where id = '${section.sectionId}'`,
    );

    await context.setOffline(false);
    const conflict = page.getByTestId("conflict");
    await expect(conflict).toContainText("modifiée ailleurs", { timeout: 15_000 });
    // Rien n'est écrasé, d'un côté comme de l'autre : l'utilisateur choisit.
    await expect(body).toHaveValue("Version écrite hors ligne.");
    await expect(conflict.getByRole("textbox")).toHaveValue("Version de l'autre appareil.");
    expect(section.stored()).toBe("Version de l'autre appareil.");

    await page.getByRole("button", { name: "Garder ma version" }).click();
    await expect(conflict).toHaveCount(0);
    await expect(page.getByTestId("save-status")).toContainText("Enregistré à");
    expect(section.stored()).toBe("Version écrite hors ligne.");
  });
});
