import { expect, test, type Page } from "@playwright/test";
import {
  completeProfileDirectly,
  createConfirmedUser,
  makeModerator,
  signInThroughForm,
  sql,
  strongPassword,
  TEST_FACTOR_SECRET,
  uniqueEmail,
  waitForEmailLink,
} from "./support/auth";
import { freshTotp } from "./support/totp";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function enableSecondFactor(
  page: Page,
  used: Set<string>,
  password: string,
  { tryWrongPassword = false } = {},
): Promise<string> {
  await page.goto("/fr/account/security");
  await expect(page.getByTestId("second-factor-state")).toContainText("désactivée");

  // Le mot de passe est redemandé : une session laissée ouverte ne suffit pas.
  // Vérifié dans un seul test : chaque saisie consomme la limite de
  // ré-authentification, partagée par tous les tests venant de la même adresse.
  if (tryWrongPassword) {
    await page.getByLabel("Mot de passe actuel").fill("MauvaisMotDePasse1");
    await page.getByRole("button", { name: "Activer la validation en deux étapes" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Mot de passe incorrect.");
    await expect(page.getByTestId("second-factor-secret")).toHaveCount(0);
  }

  await page.getByLabel("Mot de passe actuel").fill(password);
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

    const secret = await enableSecondFactor(page, used, password, { tryWrongPassword: true });
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
    await page.getByLabel("Mot de passe actuel").fill(password);
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

  test("un mot de passe oublié se réinitialise aussi avec la validation en deux étapes", async ({
    page,
  }) => {
    const email = uniqueEmail("oubli-deux-etapes");
    const password = strongPassword();
    const newPassword = strongPassword();
    const used = new Set<string>();
    await createConfirmedUser(email, password);
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/account/);
    const secret = await enableSecondFactor(page, used, password);

    await page.goto("/fr/account/profile");
    await page.getByRole("button", { name: "Se déconnecter" }).click();

    await page.goto("/fr/forgot-password");
    await page.getByLabel("Adresse électronique").fill(email);
    await page.getByRole("button", { name: "Recevoir le lien" }).click();
    await page.goto(await waitForEmailLink(email, "recovery"));
    await page.getByRole("button", { name: "Continuer" }).click();

    // Le code est demandé avant de choisir le mot de passe.
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify\?next=%2Freset-password/);
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(secret, used));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/fr\/reset-password/);
    await expect(page.getByTestId("reset-account-email")).toHaveText(email);

    await page.getByLabel("Nouveau mot de passe").fill(newPassword);
    await page.getByLabel("Confirmez le mot de passe").fill(newPassword);
    await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
    await expect(page).toHaveURL(/\/fr\/sign-in\?notice=password-updated/);

    // Le nouveau mot de passe vaut, et le code reste demandé.
    await signInThroughForm(page, email, newPassword);
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
  });

  test("un compte au rôle privilégié ne peut pas désactiver son second facteur", async ({
    page,
  }) => {
    const email = uniqueEmail("role-privilegie");
    const password = strongPassword();
    const used = new Set<string>();
    const id = await createConfirmedUser(email, password);
    completeProfileDirectly(id);
    makeModerator(id);

    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, used));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/fr\/account/);

    await page.goto("/fr/account/security");
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(TEST_FACTOR_SECRET, used));
    await page.getByRole("button", { name: "Désactiver la validation en deux étapes" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Votre rôle exige la validation en deux étapes",
    );
    await expect(page.getByTestId("second-factor-state")).toContainText("activée");
  });

  test("l'application limite les essais de code avant même le blocage en base", async ({
    page,
  }) => {
    const email = uniqueEmail("essais-bornes");
    const password = strongPassword();
    const used = new Set<string>();
    await createConfirmedUser(email, password);
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/account/);
    await enableSecondFactor(page, used, password);

    await page.goto("/fr/account/profile");
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);

    const alert = page.getByRole("main").getByRole("alert");
    let incorrect = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.getByLabel("Code à six chiffres").fill(String(100000 + attempt));
      await page.getByRole("button", { name: "Vérifier" }).click();
      // Le formulaire se vide quand le serveur a répondu : attendre ce moment
      // garantit que chaque essai est bien traité avant le suivant.
      await expect(page.getByLabel("Code à six chiffres")).toHaveValue("");
      await expect(alert).toBeVisible();
      if ((await alert.textContent())?.includes("Trop de tentatives")) break;
      incorrect += 1;
    }
    // Moins d'essais que le seuil du blocage en base (dix) : par l'interface,
    // c'est la limite de l'application qui s'applique la première.
    expect(incorrect).toBeGreaterThan(0);
    expect(incorrect).toBeLessThan(10);
    await expect(alert).toContainText("Trop de tentatives");
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
  });

  test("un facteur bloqué en base refuse même le bon code et ferme la session", async ({
    page,
  }) => {
    const email = uniqueEmail("facteur-bloque");
    const password = strongPassword();
    const used = new Set<string>();
    const id = await createConfirmedUser(email, password);
    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/account/);
    const secret = await enableSecondFactor(page, used, password);

    await page.goto("/fr/account/profile");
    await page.getByRole("button", { name: "Se déconnecter" }).click();

    // État laissé par dix codes erronés envoyés directement au service
    // d'authentification (le test d'intégration couvre ce chemin de bout en bout).
    sql(
      `insert into private.second_factor_attempts (factor_id, window_start, failures)
       select id, now(), 10 from auth.mfa_factors where user_id = '${id}'
       on conflict (factor_id) do update set window_start = now(), failures = 10`,
    );

    await signInThroughForm(page, email, password);
    await expect(page).toHaveURL(/\/fr\/sign-in\/verify/);
    await page.getByLabel("Code à six chiffres").fill(await freshTotp(secret, used));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/fr\/sign-in\?notice=code-refused/);
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "déconnecté de tous vos appareils",
    );

    // La session a bien été refermée.
    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/sign-in/);
  });

  test("la page de sécurité exige une session", async ({ page }) => {
    await page.goto("/fr/account/security");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=/);
    await page.goto("/fr/sign-in/verify");
    await expect(page).toHaveURL(/\/fr\/sign-in(\?|$)/);
  });
});
