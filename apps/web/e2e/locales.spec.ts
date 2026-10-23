import { expect, test } from "@playwright/test";
import { en } from "../src/content/help/en";
import { fr } from "../src/content/help/fr";
import { pt } from "../src/content/help/pt";
import { HELP_TOPICS } from "../src/content/help/types";
import {
  completeProfileDirectly,
  createConfirmedUser,
  sqlValue,
  strongPassword,
  uniqueEmail,
} from "./support/auth";

// Troisième langue d'interface (F-04) et aide en ligne (F-05).

// Une adresse de client propre à ce fichier : ses connexions ne pèsent pas sur
// la limite par adresse que se partagent les autres parcours.
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.26" } });

test.describe("interface en portugais", () => {
  test("accueil et connexion en portugais ; le sélecteur garde la page", async ({ page }) => {
    await page.goto("/pt");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");
    await expect(page.getByText("Encontrar, organizar, produzir.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ajuda" })).toBeVisible();

    await page.goto("/pt/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Iniciar sessão");
    await expect(page.getByLabel("Endereço de correio eletrónico")).toBeVisible();

    // Chaque langue est nommée dans sa propre langue, et le lien garde la page.
    const switcher = page.getByRole("navigation", { name: "Língua" });
    await expect(switcher.getByRole("link")).toHaveText(["Français", "English", "Português"]);
    await expect(switcher.getByRole("link", { name: "Português" })).toHaveAttribute("aria-current", "true");
    await switcher.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "Français" }).click();
    await expect(page).toHaveURL(/\/fr\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Se connecter");
    await page.getByRole("navigation", { name: "Langue" }).getByRole("link", { name: "Português" }).click();
    await expect(page).toHaveURL(/\/pt\/sign-in$/);
  });

  test("recherche et profil en portugais ; le portugais s'enregistre comme langue préférée", async ({ page }) => {
    const email = uniqueEmail("pt");
    const password = strongPassword();
    const id = await createConfirmedUser(email, password);
    completeProfileDirectly(id);

    await page.goto("/pt/sign-in");
    await page.getByLabel("Endereço de correio eletrónico").fill(email);
    await page.getByLabel("Palavra-passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page).toHaveURL(/\/pt\/account/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A minha conta");

    // --- Recherche ----------------------------------------------------------
    await page.goto("/pt/search");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pesquisar no catálogo");
    await expect(page.getByRole("button", { name: "Pesquisar" })).toBeVisible();
    // Pluriels par ICU : « Nenhum resultado », « 1 resultado », « N resultados ».
    await expect(page.locator("#results-heading")).toHaveText(/^(Nenhum resultado|1 resultado|[\d\s.]+ resultados|Mais de .+)$/);
    // Les référentiels ne sont rédigés qu'en français et en anglais : l'interface portugaise lit l'anglais.
    await expect(page.getByLabel("Disciplina").locator("option", { hasText: "Algorithms" })).toHaveCount(1);
    await expect(page.getByLabel("Disciplina").locator("option", { hasText: "Algorithmique" })).toHaveCount(0);

    // --- Profil : le portugais se choisit et s'enregistre ---------------------
    await page.goto("/pt/account/profile");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("O meu perfil");
    const preferred = page.getByLabel("Língua preferida");
    await expect(preferred.locator("option")).toHaveText(["Escolher…", "Français", "English", "Português"]);
    await preferred.selectOption({ label: "Português" });
    await page.getByRole("button", { name: "Guardar o meu perfil" }).click();
    await expect(page).toHaveURL(/\/pt\/account\?notice=profile-saved/);
    await expect(page.getByRole("main").getByRole("status")).toHaveText("O seu perfil foi guardado.");
    expect(sqlValue(`select preferred_locale from public.profiles where user_id = '${id}'`)).toBe("pt");
    // Le pays s'affiche en anglais, à défaut de libellé portugais.
    await expect(page.getByRole("main")).toContainText("Senegal");
  });
});

test.describe("aide en ligne", () => {
  const contents = { fr, en, pt } as const;

  test("l'index de l'aide s'ouvre depuis le pied de page, sans session", async ({ page }) => {
    await page.goto("/fr");
    await page.getByRole("contentinfo").getByRole("link", { name: "Aide" }).click();
    await expect(page).toHaveURL(/\/fr\/help$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aide");
    await expect(page.getByTestId("help-topic")).toHaveCount(HELP_TOPICS.length);
    // Page publique : elle s'indexe.
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    await page.getByRole("link", { name: fr.topics.offline.title }).click();
    await expect(page).toHaveURL(/\/fr\/help\/offline$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.topics.offline.title);
    await page.getByRole("link", { name: fr.backToIndex }).click();
    await expect(page).toHaveURL(/\/fr\/help$/);

    expect((await page.goto("/fr/help/sujet-inconnu"))?.status()).toBe(404);
  });

  for (const [locale, content] of Object.entries(contents)) {
    test(`chaque page d'aide existe en ${locale}, et ses liens mènent à une page`, async ({ page, request }) => {
      const checked = new Set<string>();
      for (const topic of HELP_TOPICS) {
        const response = await page.goto(`/${locale}/help/${topic}`);
        expect(response?.status(), topic).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(content.topics[topic].title);
        await expect(page.getByTestId("help-section")).toHaveCount(content.topics[topic].sections.length);

        const hrefs = await page
          .getByRole("main")
          .locator("a[href]")
          .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
        for (const href of hrefs) {
          // Aucun lien hors du site, tous dans la langue de la page.
          expect(href, `${topic} → ${href}`).toMatch(new RegExp(`^/${locale}(/|$)`));
          if (checked.has(href)) continue;
          checked.add(href);
          const target = await request.get(href);
          expect(target.status(), `${topic} → ${href}`).toBe(200);
        }
      }
      expect(checked.size).toBeGreaterThan(10);
    });
  }
});

test.describe("pages juridiques provisoires", () => {
  const banner = {
    fr: "Version provisoire, en cours de validation juridique.",
    en: "Provisional version, under legal review.",
    pt: "Versão provisória, em validação jurídica.",
  } as const;
  const titles = {
    fr: "Politique de confidentialité",
    en: "Privacy policy",
    pt: "Política de privacidade",
  } as const;

  for (const locale of ["fr", "en", "pt"] as const) {
    test(`les quatre pages s'affichent en ${locale}, avec le bandeau, sans session`, async ({ page }) => {
      for (const legal of ["privacy", "content", "ai", "minors"]) {
        const response = await page.goto(`/${locale}/legal/${legal}`);
        expect(response?.status(), legal).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByTestId("legal-provisional")).toHaveText(banner[locale]);
        // Le texte de fond est en français, et marqué comme tel.
        await expect(page.getByTestId("legal-body")).toHaveAttribute("lang", "fr");
        await expect(page.getByTestId("legal-french-only")).toHaveCount(locale === "fr" ? 0 : 1);
        // Aucune mention de travail : seules les informations à fournir, bien visibles.
        await expect(page.getByRole("main")).not.toContainText("À COMPLÉTER");
        await expect(page.getByRole("main")).not.toContainText("BROUILLON");
      }
      await page.goto(`/${locale}/legal/privacy`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(titles[locale]);
      await expect(page.getByRole("main")).toContainText("Cloudflare (Turnstile)");
      await expect(page.getByRole("main")).toContainText("Have I Been Pwned");
      // Hors production, une information à fournir s'affiche « [à compléter] ».
      await expect(page.getByTestId("legal-missing").first()).toHaveText("[à compléter]");
      expect((await page.goto(`/${locale}/legal/inconnue`))?.status()).toBe(404);
    });
  }

  test("liées depuis le pied de page et depuis l'inscription", async ({ page }) => {
    await page.goto("/fr");
    await page.getByRole("contentinfo").getByRole("link", { name: "Confidentialité" }).click();
    await expect(page).toHaveURL(/\/fr\/legal\/privacy$/);

    await page.goto("/fr/sign-up");
    const notice = page.getByTestId("signup-legal");
    await expect(notice.getByRole("link", { name: "politique de confidentialité" })).toHaveAttribute("href", "/fr/legal/privacy");
    await expect(notice.getByRole("link", { name: "contenu, licences et retrait" })).toHaveAttribute("href", "/fr/legal/content");
    await expect(notice.getByRole("link", { name: "protection des mineurs" })).toHaveAttribute("href", "/fr/legal/minors");
    // Le serveur de test tourne avec l'inscription ouverte (SIGNUP_MODE absent) ;
    // le mode « sur invitation » est vérifié par un test unitaire.
    await expect(page.getByRole("button", { name: "Créer mon compte" })).toBeVisible();
  });
});
