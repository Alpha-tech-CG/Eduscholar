import { expect, test, type Page } from "@playwright/test";
import {
  createConfirmedUser,
  signInThroughForm,
  strongPassword,
  uniqueEmail,
} from "./support/auth";
import { freshTotp } from "./support/totp";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function enableSecondFactor(page: Page, used: Set<string>): Promise<string> {
  await page.goto("/fr/account/security");
  await expect(page.getByTestId("second-factor-state")).toContainText("désactivée");
  await page.getByRole("button", { name: "Activer la validation en deux étapes" }).click();

  const secret = (await page.getByTestId("second-factor-secret").innerText()).trim();
  await expect(page.getByRole("img", { name: /Code à scanner/ })).toBeVisible();

  await page.getByLabel("Code à six chiffres").fill(await freshTotp(secret, used));
  await page.getByRole("button", { name: "Vérifier et activer" }).click();

  await expect(page).toHaveURL(/\/fr\/account\/security\?notice=enabled/);
  await expect(page.getByTestId("second-factor-state")).toContainText("activée");
  return secret;
}

test.describe("validation en deux étapes", () => {
  // Les codes changent toutes les trente secondes : certains tests attendent un pas.
  test.setTimeout(150_000);

  test("elle s'active, est exigée à la connexion, puis se désactive", async ({ page }) => {
    const email = uniqueEmail("deux-etapes");
    const password = strongPassword();
    const used = new Set<string>();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    await createConfirmedUser(email, password);
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/account/);

    const secret = await enableSecondFactor(page, used);
    await expect(status(page)).toContainText("Un code vous sera demandé à chaque connexion");

    // Déconnexion puis reconnexion : le mot de passe ne suffit plus.
    await page.goto("/fr/account/profile");
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);

    // Sans le code, aucune page protégée n'est accessible.
    for (const path of ["/fr/account", "/fr/account/profile", "/fr/account/security", "/fr/account/delete"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/fr\/sign-in\/verify/);
    }

    // Un mauvais code est refusé.
    await page.getByLabel("Code à six chiffres").fill("000000");
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(alert(page)).toContainText("Code incorrect ou expiré");

    // Le bon code ouvre la session complète.
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(secret, used));
    await page.getByRole("button", { name: "Vérifier" }).click();
    // On arrive sur la dernière page demandée, ici la suppression du compte.
    await expect(page).toHaveURL(/\/fr\/account\/delete/);
    await page.goto("/fr/account/profile");
    await expect(page.getByTestId("account-email")).toHaveText(email);

    // Désactivation : un code saisi à l'instant est exigé.
    await page.goto("/fr/account/security");
    await page.getByLabel("Code à six chiffres").fill("000000");
    await page.getByRole("button", { name: "Désactiver la validation en deux étapes" }).click();
    await expect(alert(page)).toContainText("Code incorrect ou expiré");
    await expect(page.getByTestId("second-factor-state")).toContainText("activée");

    await page.getByLabel("Code à six chiffres").fill(await freshTotp(secret, used));
    await page.getByRole("button", { name: "Désactiver la validation en deux étapes" }).click();
    await expect(page, pageErrors.join(" | ")).toHaveURL(
      /\/fr\/account\/security\?notice=disabled/,
    );
    await expect(page.getByTestId("second-factor-state")).toContainText("désactivée");
  });

  test("un code invalide n'active rien", async ({ page }) => {
    const email = uniqueEmail("code-invalide");
    const password = strongPassword();
    await createConfirmedUser(email, password);
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/account/);

    await page.goto("/fr/account/security");
    await page.getByRole("button", { name: "Activer la validation en deux étapes" }).click();
    await expect(page.getByTestId("second-factor-secret")).toBeVisible();

    for (const code of ["000000", "12345", "abcdef"]) {
      await page.getByLabel("Code à six chiffres").fill(code);
      await page.getByRole("button", { name: "Vérifier et activer" }).click();
      await expect(alert(page)).toContainText("Code incorrect ou expiré");
    }

    await page.goto("/fr/account/security");
    await expect(page.getByTestId("second-factor-state")).toContainText("désactivée");
  });

  test("la page de sécurité exige une session", async ({ page }) => {
    await page.goto("/fr/account/security");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=/);
    await page.goto("/fr/sign-in/verify");
    await expect(page).toHaveURL(/\/fr\/sign-in(\?|$)/);
  });
});
