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

const alert = (page: Page) => page.getByRole("main").getByRole("alert");

async function signInOnboarded(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  const id = await createConfirmedUser(email, password);
  completeProfileDirectly(id);
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account/);
  return id;
}

/** Un projet et deux sources, créés directement en base pour le compte donné. */
function seedProject(ownerId: string) {
  const projectId = randomUUID();
  const token = `plan${Date.now()}${Math.round(Math.random() * 1e6)}`;
  sql(`
    insert into public.research_projects (id, owner_id, title) values ('${projectId}', '${ownerId}', 'Mémoire ${token}');
    insert into public.project_sources (project_id, source_type, title, authors, publication_year) values
      ('${projectId}', 'article', 'Réseaux profonds ${token}', array['Diop, Awa'], 2021),
      ('${projectId}', 'book', 'Manuel ${token}', array['Mensah, Kofi'], 2019)
  `);
  return { projectId, token };
}

async function addSection(page: Page, title: string, level: string) {
  await page.getByLabel("Titre de la section").fill(title);
  await page.getByLabel("Niveau de titre").selectOption({ label: level });
  await page.getByRole("button", { name: "Ajouter au plan" }).click();
  await expect(page).toHaveURL(/\/outline\/[0-9a-f-]{36}\?notice=added/);
}

test.describe("plan du mémoire", () => {
  test.setTimeout(150_000);

  test("plan, rédaction, citations, conflit et cloisonnement", async ({ page, browser }) => {
    const ownerId = await signInOnboarded(page, "plan");
    const { projectId, token } = seedProject(ownerId);
    const outline = `/fr/projects/${projectId}/outline`;

    await page.goto(`/fr/projects/${projectId}`);
    await expect(page.getByTestId("section-count")).toHaveText("Aucune section rédigée pour l'instant.");
    await page.getByRole("link", { name: "Ouvrir le plan du mémoire" }).click();
    await expect(page).toHaveURL(new RegExp(outline));
    await expect(page.getByRole("heading", { name: "Aucune section" })).toBeVisible();

    // Titre vide : refus.
    await page.getByRole("button", { name: "Ajouter au plan" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");

    // --- Trois sections ------------------------------------------------------
    await addSection(page, "Introduction", "Chapitre");
    const introUrl = page.url().split("?")[0] ?? "";
    await page.goto(outline);
    await addSection(page, "Méthodes classiques", "Section");
    await page.goto(outline);
    await addSection(page, "État de l'art", "Chapitre");
    const stateUrl = page.url().split("?")[0] ?? "";

    await page.goto(outline);
    await expect(page.getByRole("heading", { name: "3 sections" })).toBeVisible();
    const items = page.getByTestId("outline-item");
    await expect(items.getByRole("link")).toHaveText([
      "1 Introduction",
      "1.1 Méthodes classiques",
      "2 État de l'art",
    ]);

    // --- Réordonner : « État de l'art » passe avant « Méthodes classiques » ---
    await page.getByRole("button", { name: "Monter « État de l'art »" }).click();
    await expect(page).toHaveURL(/notice=moved/);
    await expect(items.getByRole("link")).toHaveText([
      "1 Introduction",
      "2 État de l'art",
      "2.1 Méthodes classiques",
    ]);
    // La première ne monte pas, la dernière ne descend pas.
    await expect(page.getByRole("button", { name: "Monter « Introduction »" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Descendre « Méthodes classiques »" })).toHaveCount(0);

    // --- Rédaction -----------------------------------------------------------
    await page.goto(stateUrl);
    const body = page.getByLabel("Texte de la section");
    const saveStatus = page.getByTestId("save-status");
    const sectionId = stateUrl.split("/").pop();
    const stored = () => sqlValue(`select coalesce(body, '') from public.thesis_sections where id = '${sectionId}'`);
    await expect(page.getByTestId("word-count")).toHaveText("Aucun mot");
    const text = "Les réseaux profonds dominent.\n\n<script>alert(1)</script> reste du texte.";
    await body.fill(text);
    // Le compte de mots suit la saisie, avant tout enregistrement.
    await expect(page.getByTestId("word-count")).toHaveText("11 mots");
    await expect(saveStatus).toHaveText("Modifications non enregistrées.");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    // L'enregistrement ne quitte pas la page.
    await expect(saveStatus).toContainText("Enregistré à");
    await expect(page).not.toHaveURL(/notice=saved/);
    expect(stored()).toBe(text);
    await page.reload();
    await expect(body).toHaveValue(text);
    await expect(page.getByTestId("word-count")).toHaveText("11 mots");

    // --- Enregistrement automatique : sans cliquer ----------------------------
    await body.fill("Texte enregistré tout seul.");
    await expect(saveStatus).toContainText("Enregistré à", { timeout: 20_000 });
    expect(stored()).toBe("Texte enregistré tout seul.");
    // Un second enregistrement s'enchaîne sans faux conflit : la version suit.
    await body.fill("Texte enregistré tout seul, puis repris.");
    await expect(saveStatus).toHaveText("Modifications non enregistrées.");
    await expect(saveStatus).toContainText("Enregistré à", { timeout: 20_000 });
    expect(stored()).toBe("Texte enregistré tout seul, puis repris.");

    // --- Conflit : la section change ailleurs pendant la saisie --------------
    const conflict = page.getByTestId("conflict");
    sql(`update public.thesis_sections set body = 'Version d''un autre appareil.' where id = '${sectionId}'`);
    await body.fill("Version de cet onglet.");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(conflict).toContainText("modifiée ailleurs");
    // Rien n'est écrasé en base, la saisie reste à l'écran, l'autre version est montrée.
    expect(stored()).toBe("Version d'un autre appareil.");
    await expect(body).toHaveValue("Version de cet onglet.");
    await expect(page.getByLabel("Texte enregistré ailleurs")).toHaveValue("Version d'un autre appareil.");
    await expect(page.getByTestId("conflict-title")).toHaveText("État de l'art");
    // Tant que le choix n'est pas fait, rien ne s'enregistre : l'attente dépasse
    // l'intervalle entre deux enregistrements automatiques.
    await body.fill("Version de cet onglet, complétée.");
    await page.waitForTimeout(13_000);
    expect(stored()).toBe("Version d'un autre appareil.");
    // Revenir au texte de l'autre version puis au sien ne fait pas perdre le choix.
    await body.fill("Version d'un autre appareil.");
    await body.fill("Version de cet onglet, complétée.");
    // Garder sa version : enregistrée sans recharger la page.
    await page.getByRole("button", { name: "Garder ma version" }).click();
    await expect(conflict).toHaveCount(0);
    await expect(saveStatus).toContainText("Enregistré à");
    expect(stored()).toBe("Version de cet onglet, complétée.");

    // Second conflit : reprendre la version enregistrée ailleurs.
    sql(`update public.thesis_sections set body = 'Version reprise.' where id = '${sectionId}'`);
    await body.fill("Brouillon abandonné.");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(conflict).toContainText("modifiée ailleurs");
    await page.getByRole("button", { name: "Reprendre la version enregistrée" }).click();
    await expect(conflict).toHaveCount(0);
    await expect(body).toHaveValue("Version reprise.");
    expect(stored()).toBe("Version reprise.");

    // --- Quitter la page : le texte en cours est enregistré d'abord -----------
    await body.fill("Texte saisi juste avant de partir.");
    await page.getByRole("link", { name: "Retour au plan" }).click();
    await expect(page).toHaveURL(new RegExp(`${outline}$`));
    expect(stored()).toBe("Texte saisi juste avant de partir.");
    await page.goto(stateUrl);
    await expect(body).toHaveValue("Texte saisi juste avant de partir.");

    // --- Déplacer une section ailleurs ne provoque pas de faux conflit --------
    await body.fill("Premier paragraphe.\r\n\r\nSecond paragraphe.");
    {
      const context = await browser.newContext({
        storageState: await page.context().storageState(),
        extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.9" },
      });
      const tab = await context.newPage();
      await tab.goto(outline);
      await tab.getByRole("button", { name: "Descendre « État de l'art »" }).click();
      await expect(tab).toHaveURL(/notice=moved/);
      await context.close();
    }
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(saveStatus).toContainText("Enregistré à");
    await expect(conflict).toHaveCount(0);
    // Stocké avec des sauts de ligne simples.
    expect(stored()).toBe("Premier paragraphe.\n\nSecond paragraphe.");

    // --- Titre vide : refusé, signalé sur le champ, texte conservé ------------
    await page.getByLabel("Titre de la section").fill("");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(alert(page)).toContainText("Certains champs sont à corriger.");
    await expect(page.getByLabel("Titre de la section")).toHaveAttribute("aria-invalid", "true");
    // Revenu au titre enregistré : plus rien à corriger ni à envoyer.
    await page.getByLabel("Titre de la section").fill("État de l'art");
    await expect(alert(page)).toHaveCount(0);
    await expect(page.getByLabel("Titre de la section")).not.toHaveAttribute("aria-invalid", "true");

    // --- Débit : au-delà de la limite, refus annoncé et texte conservé --------
    sql(`insert into private.rate_limit_buckets (bucket_key, window_start, hits)
         values ('section-save:user:' || left(encode(sha256(convert_to('section-save:${ownerId}', 'UTF8')), 'hex'), 40), to_timestamp(floor(extract(epoch from clock_timestamp()) / 600) * 600), 200)
         on conflict (bucket_key, window_start) do update set hits = 200`);
    await body.fill("Texte refusé pour l'instant.");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(alert(page)).toContainText("Trop d'enregistrements en peu de temps.");
    await expect(body).toHaveValue("Texte refusé pour l'instant.");
    expect(stored()).toBe("Premier paragraphe.\n\nSecond paragraphe.");
    sql(`delete from private.rate_limit_buckets where bucket_key = 'section-save:user:' || left(encode(sha256(convert_to('section-save:${ownerId}', 'UTF8')), 'hex'), 40)`);
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(saveStatus).toContainText("Enregistré à");
    await body.fill("Premier paragraphe.\n\nSecond paragraphe.");
    await page.getByRole("button", { name: "Enregistrer la section" }).click();
    await expect(saveStatus).toContainText("Enregistré à");
    await page.reload();

    // --- Sources citées ------------------------------------------------------
    await expect(page.getByRole("heading", { name: "Sources citées (0)" })).toBeVisible();
    await page.getByLabel("Source à citer").selectOption({ label: `Diop, Awa · 2021 · Réseaux profonds ${token}` });
    await page.getByLabel("Pages citées").fill("p. 12-14");
    await page.getByRole("button", { name: "Citer cette source" }).click();
    await expect(page).toHaveURL(/notice=cited/);
    await expect(page.getByRole("heading", { name: "Sources citées (1)" })).toBeVisible();
    await expect(page.getByTestId("citation")).toContainText(`Réseaux profonds ${token}`);
    await expect(page.getByTestId("citation")).toContainText("p. 12-14");
    // La source déjà citée n'est plus proposée.
    await expect(
      page.getByLabel("Source à citer").locator("option", { hasText: "Réseaux profonds" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Retirer la citation" }).click();
    await expect(page).toHaveURL(/notice=citation-removed/);
    await expect(page.getByRole("heading", { name: "Sources citées (0)" })).toBeVisible();

    // --- Cloisonnement -------------------------------------------------------
    const context = await browser.newContext();
    const other = await context.newPage();
    const otherId = await signInOnboarded(other, "plan-autre");
    for (const path of [outline, stateUrl]) {
      expect((await other.goto(path))?.status(), path).toBe(404);
    }
    // Une section servie sous un projet qui n'est pas le sien : introuvable.
    const otherProject = seedProject(otherId).projectId;
    expect((await other.goto(`/fr/projects/${otherProject}/outline/${sectionId}`))?.status()).toBe(404);
    await context.close();

    // --- Suppression ---------------------------------------------------------
    await page.goto(introUrl);
    await page.getByRole("button", { name: "Supprimer cette section" }).click();
    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await page.getByLabel("Je veux supprimer cette section et son texte.").check();
    await page.getByRole("button", { name: "Supprimer cette section" }).click();
    await expect(page).toHaveURL(/outline\?notice=deleted/);
    await expect(items.getByRole("link")).toHaveText(["1.1 Méthodes classiques", "1 État de l'art"]);
    expect((await page.goto(introUrl))?.status()).toBe(404);

    await page.goto(`/fr/projects/${projectId}`);
    await expect(page.getByTestId("section-count")).toHaveText("2 sections au plan.");
  });

  test("le plan exige une session", async ({ page }) => {
    const id = randomUUID();
    await page.goto(`/fr/projects/${id}/outline`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
    await page.goto(`/fr/projects/${id}/outline/${randomUUID()}`);
    await expect(page).toHaveURL(/\/fr\/sign-in/);
  });
});
