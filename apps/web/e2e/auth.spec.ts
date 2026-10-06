import { expect, test, type Page } from "@playwright/test";
import {
  createConfirmedUser,
  directSignUp,
  expectSignedIn,
  signInThroughForm,
  strongPassword,
  uniqueEmail,
  waitForEmailLink,
  waitForEmailSubject,
} from "./support/auth";

const GENERIC_SIGN_IN_ERROR =
  "Adresse ou mot de passe incorrect, ou adresse non encore confirmée.";

const alert = (page: Page) => page.getByRole("main").getByRole("alert");
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function fillSignUp(page: Page, email: string, password: string) {
  await page.goto("/fr/sign-up");
  await page.getByLabel("Adresse électronique").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByLabel("Confirmez le mot de passe").fill(password);
  await page.getByLabel(/Je déclare avoir l'âge requis/).check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(status(page)).toContainText("un message vient d'y être envoyé");
}

async function sessionCookies(page: Page) {
  return (await page.context().cookies()).filter(({ name }) => name.includes("es-session"));
}

test.describe("inscription", () => {
  test("un compte se crée, se confirme par courriel, puis on se connecte", async ({ page }) => {
    const email = uniqueEmail("inscription");
    const password = strongPassword();

    await fillSignUp(page, email, password);

    // Avant confirmation, la connexion est refusée avec le message générique.
    await signInThroughForm(page, email, password);
    await expect(alert(page)).toHaveText(GENERIC_SIGN_IN_ERROR);

    const link = await waitForEmailLink(email);

    // Charger le lien ne consomme pas le jeton : un analyseur de courriels qui
    // l'ouvre ne confirme rien à la place de l'utilisateur.
    const prefetch = await page.request.get(link);
    expect(prefetch.ok()).toBe(true);

    await page.goto(link);
    await expect(page).toHaveURL(/\/fr\/auth\/confirm/);
    await page.getByRole("button", { name: "Confirmer mon adresse" }).click();

    // La confirmation n'ouvre pas de session : il faut se connecter.
    await expect(page).toHaveURL(/\/fr\/sign-in\?notice=email-confirmed/);
    await expect(status(page)).toContainText("Votre adresse est confirmée");
    expect(await sessionCookies(page)).toEqual([]);

    await page.getByLabel("Adresse électronique").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expectSignedIn(page, email);

    // La session est portée par des cookies inaccessibles au JavaScript,
    // réservés à cet hôte exact.
    const cookies = await sessionCookies(page);
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.name, cookie.name).toMatch(/^__Host-/);
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.secure, cookie.name).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe("Lax");
      expect(cookie.path, cookie.name).toBe("/");
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain("es-session");

    // La page du compte n'est mise en cache nulle part.
    const account = await page.request.get("/fr/account");
    expect(account.headers()["cache-control"]).toContain("no-store");

    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/fr$/);
    expect(await sessionCookies(page)).toEqual([]);

    // Après déconnexion, la page protégée renvoie vers la connexion.
    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Faccount/);

    // Le lien de confirmation ne sert qu'une fois.
    await page.goto(link);
    await page.getByRole("button", { name: "Confirmer mon adresse" }).click();
    await expect(alert(page)).toContainText("Ce lien n'est plus valable");
  });

  test("les champs invalides sont refusés par le serveur avec un message par champ", async ({
    page,
  }) => {
    await page.goto("/fr/sign-up");
    await page.getByLabel("Adresse électronique").fill("pas-une-adresse");
    await page.getByLabel("Mot de passe", { exact: true }).fill("court1");
    await page.getByLabel("Confirmez le mot de passe").fill("different1");
    await page.getByRole("button", { name: "Créer mon compte" }).click();

    await expect(alert(page)).toHaveText("Certains champs sont à corriger.");
    await expect(page.getByText("Indiquez une adresse électronique valide.")).toBeVisible();
    await expect(
      page.getByText("Le mot de passe doit compter au moins 12 caractères."),
    ).toBeVisible();
    await expect(
      page.getByText("Cette déclaration est nécessaire pour créer un compte."),
    ).toBeVisible();
    // L'adresse saisie est conservée, jamais le mot de passe.
    await expect(page.getByLabel("Adresse électronique")).toHaveValue("pas-une-adresse");
    await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveValue("");
  });

  test("la réponse est la même pour une adresse déjà enregistrée", async ({ page }) => {
    const email = uniqueEmail("existant");
    await createConfirmedUser(email, strongPassword());
    await fillSignUp(page, email, strongPassword());
  });

  test("une inscription antérieure par un tiers ne lui donne pas le compte", async ({
    page,
  }) => {
    // Le parcours attend le délai entre deux courriels pour une même adresse.
    test.setTimeout(150_000);

    const email = uniqueEmail("victime");
    const attackerPassword = strongPassword();
    const victimPassword = strongPassword();
    const finalPassword = strongPassword();

    // 1. Un tiers inscrit l'adresse de la victime avec son propre mot de passe,
    //    directement auprès du service d'authentification.
    await directSignUp(email, attackerPassword);
    const link = await waitForEmailLink(email);

    // 2. La victime s'inscrit à son tour, puis confirme par le lien reçu.
    await fillSignUp(page, email, victimPassword);
    await page.goto(link);
    await page.getByRole("button", { name: "Confirmer mon adresse" }).click();

    // 3. Elle n'est pas connectée d'office : l'intrusion ne peut pas passer inaperçue.
    await expect(page).toHaveURL(/\/fr\/sign-in\?notice=email-confirmed/);
    expect(await sessionCookies(page)).toEqual([]);

    // 4. Son mot de passe n'est pas celui du compte : elle doit le réinitialiser.
    await signInThroughForm(page, email, victimPassword);
    await expect(alert(page)).toHaveText(GENERIC_SIGN_IN_ERROR);

    await page.waitForTimeout(61_000);
    await page.goto("/fr/forgot-password");
    await page.getByLabel("Adresse électronique").fill(email);
    await page.getByRole("button", { name: "Recevoir le lien" }).click();
    await expect(status(page)).toContainText("Si un compte existe");

    const recovery = await waitForEmailLink(email, "recovery");
    await page.goto(recovery);
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByTestId("reset-account-email")).toHaveText(email);
    await page.getByLabel("Nouveau mot de passe").fill(finalPassword);
    await page.getByLabel("Confirmez le mot de passe").fill(finalPassword);
    await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
    await expect(page).toHaveURL(/\/fr\/sign-in\?notice=password-updated/);

    // 5. Le mot de passe du tiers ne vaut plus rien ; celui de la victime, si.
    await signInThroughForm(page, email, attackerPassword);
    await expect(alert(page)).toHaveText(GENERIC_SIGN_IN_ERROR);

    await signInThroughForm(page, email, finalPassword);
    await expectSignedIn(page, email);
  });
});

test.describe("connexion", () => {
  test("le message est identique pour un compte inconnu et un mauvais mot de passe", async ({
    page,
  }) => {
    const email = uniqueEmail("connu");
    await createConfirmedUser(email, strongPassword());

    await signInThroughForm(page, email, "MauvaisMotDePasse1");
    await expect(alert(page)).toHaveText(GENERIC_SIGN_IN_ERROR);

    await signInThroughForm(page, uniqueEmail("inconnu"), "MauvaisMotDePasse1");
    await expect(alert(page)).toHaveText(GENERIC_SIGN_IN_ERROR);
  });

  test("après connexion, on revient à la page demandée", async ({ page }) => {
    const email = uniqueEmail("retour");
    const password = strongPassword();
    await createConfirmedUser(email, password);

    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/sign-in\?next=%2Faccount/);
    await page.getByLabel("Adresse électronique").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expectSignedIn(page, email);

    // Déjà connecté : la page de connexion renvoie vers le compte.
    await page.goto("/fr/sign-in");
    await expect(page).toHaveURL(/\/fr\/account/);
  });

  test("une destination externe est ignorée", async ({ page, baseURL }) => {
    const email = uniqueEmail("redirection");
    const password = strongPassword();
    await createConfirmedUser(email, password);

    for (const target of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "/fr//evil.example",
    ]) {
      await page.context().clearCookies();
      await page.goto(`/fr/sign-in?next=${encodeURIComponent(target)}`);
      await page.getByLabel("Adresse électronique").fill(email);
      await page.getByLabel("Mot de passe").fill(password);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(new URL(page.url()).host, target).toBe(new URL(baseURL!).host);
    }
  });

  test("la session suit l'utilisateur en anglais", async ({ page }) => {
    const email = uniqueEmail("anglais");
    const password = strongPassword();
    await createConfirmedUser(email, password);

    await page.goto("/en/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/en\/account/);
    await expect(page.getByTestId("account-email")).toHaveText(email);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to EduScholar");
  });

  test("le texte d'un message ne vient jamais de l'adresse", async ({ page }) => {
    await page.goto("/fr/sign-in?notice=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    await expect(status(page)).toHaveCount(0);
    await expect(page.getByText("alert(1)")).toHaveCount(0);
  });
});

test.describe("limitation de débit", () => {
  test("les tentatives répétées d'un même client sur un compte sont refusées, sans bloquer le titulaire ailleurs", async ({
    browser,
  }) => {
    const email = uniqueEmail("force-brute");
    const password = strongPassword();
    await createConfirmedUser(email, password);

    // L'en-tête ci-dessous est l'en-tête de confiance du serveur de test : il
    // tient lieu d'adresse du client.
    const attacker = await browser.newContext({
      extraHTTPHeaders: { "x-e2e-client-ip": "203.0.113.10" },
    });
    const attackerPage = await attacker.newPage();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await signInThroughForm(attackerPage, email, `Mauvais-${attempt}-motdepasse`);
      await expect(alert(attackerPage)).toHaveText(GENERIC_SIGN_IN_ERROR);
    }

    // Onzième tentative du même client : refusée, même avec le bon mot de passe.
    await signInThroughForm(attackerPage, email, password);
    await expect(alert(attackerPage)).toHaveText(
      "Trop de tentatives. Réessayez dans quelques minutes.",
    );
    await attacker.close();

    // Le titulaire, depuis une autre adresse, se connecte normalement.
    const owner = await browser.newContext({
      extraHTTPHeaders: { "x-e2e-client-ip": "203.0.113.20" },
    });
    const ownerPage = await owner.newPage();
    await signInThroughForm(ownerPage, email, password);
    await expectSignedIn(ownerPage, email);
    await owner.close();
  });

  test("un en-tête x-forwarded-for choisi par le client ne contourne pas la limite", async ({
    browser,
  }) => {
    const email = uniqueEmail("usurpation-ip");
    await createConfirmedUser(email, strongPassword());

    for (let attempt = 0; attempt < 11; attempt += 1) {
      // Même client réel, adresse annoncée différente à chaque requête.
      const context = await browser.newContext({
        extraHTTPHeaders: {
          "x-e2e-client-ip": "203.0.113.30",
          "x-forwarded-for": `198.51.100.${attempt + 1}`,
        },
      });
      const page = await context.newPage();
      await signInThroughForm(page, email, `Mauvais-${attempt}-motdepasse`);
      await expect(alert(page)).toHaveText(
        attempt < 10
          ? GENERIC_SIGN_IN_ERROR
          : "Trop de tentatives. Réessayez dans quelques minutes.",
      );
      await context.close();
    }
  });
});

test.describe("réinitialisation du mot de passe", () => {
  test("un mot de passe oublié se remplace par le lien reçu", async ({ page }) => {
    const email = uniqueEmail("oubli");
    const oldPassword = strongPassword();
    const newPassword = strongPassword();
    await createConfirmedUser(email, oldPassword);

    await page.goto("/fr/forgot-password");
    await page.getByLabel("Adresse électronique").fill(email);
    await page.getByRole("button", { name: "Recevoir le lien" }).click();
    await expect(status(page)).toContainText("Si un compte existe");

    const link = await waitForEmailLink(email, "recovery");

    await page.goto(link);
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(/\/fr\/reset-password/);
    // L'adresse du compte concerné est affichée.
    await expect(page.getByTestId("reset-account-email")).toHaveText(email);

    await page.getByLabel("Nouveau mot de passe").fill(newPassword);
    await page.getByLabel("Confirmez le mot de passe").fill(newPassword);
    await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();

    // Toutes les sessions sont fermées, celle-ci comprise.
    await expect(page).toHaveURL(/\/fr\/sign-in\?notice=password-updated/);
    await expect(status(page)).toContainText("Votre mot de passe a été modifié");
    expect(await sessionCookies(page)).toEqual([]);

    // Le titulaire est prévenu par courriel.
    await waitForEmailSubject(email, "Mot de passe modifié");

    await signInThroughForm(page, email, oldPassword);
    await expect(alert(page)).toHaveText(GENERIC_SIGN_IN_ERROR);

    await signInThroughForm(page, email, newPassword);
    await expectSignedIn(page, email);
  });

  test("la réponse est la même pour une adresse inconnue", async ({ page }) => {
    await page.goto("/fr/forgot-password");
    await page.getByLabel("Adresse électronique").fill(uniqueEmail("personne"));
    await page.getByRole("button", { name: "Recevoir le lien" }).click();
    await expect(status(page)).toContainText("Si un compte existe");
  });

  test("sans session, la page de nouveau mot de passe renvoie à la demande de lien", async ({
    page,
  }) => {
    await page.goto("/fr/reset-password");
    await expect(page).toHaveURL(/\/fr\/forgot-password/);
  });

  test("une session ouverte par mot de passe ne permet pas de choisir un nouveau mot de passe", async ({
    page,
  }) => {
    const email = uniqueEmail("poste-partage");
    const password = strongPassword();
    await createConfirmedUser(email, password);

    await signInThroughForm(page, email, password);
    await expectSignedIn(page, email);

    // Session laissée ouverte sur un poste partagé : un tiers ne peut pas
    // s'emparer du compte en choisissant un mot de passe.
    await page.goto("/fr/reset-password");
    await expect(page).toHaveURL(/\/fr\/forgot-password/);
    await expect(page.getByLabel("Nouveau mot de passe")).toHaveCount(0);
  });
});

test.describe("liens de confirmation", () => {
  test("un lien mal formé affiche une erreur sans rien tenter", async ({ page }) => {
    await page.goto("/fr/auth/confirm?token_hash=abc&type=email");
    await expect(alert(page)).toContainText("Ce lien n'est plus valable");
    await expect(page.getByRole("button", { name: "Confirmer mon adresse" })).toHaveCount(0);
  });

  test("un jeton inconnu est refusé", async ({ page }) => {
    await page.goto(`/fr/auth/confirm?token_hash=${"a".repeat(56)}&type=email`);
    await page.getByRole("button", { name: "Confirmer mon adresse" }).click();
    await expect(alert(page)).toContainText("Ce lien n'est plus valable");
  });

  test("la page ne transmet pas son adresse aux autres sites", async ({ page }) => {
    await page.goto(`/fr/auth/confirm?token_hash=${"a".repeat(56)}&type=email`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "no-referrer",
    );
  });

  test("le lien d'un tiers ne remplace pas la session d'une personne connectée", async ({
    page,
  }) => {
    // Un tiers s'inscrit et envoie son propre lien de confirmation à la victime.
    const attackerEmail = uniqueEmail("tiers");
    await directSignUp(attackerEmail, strongPassword());
    const attackerLink = await waitForEmailLink(attackerEmail);

    const victimEmail = uniqueEmail("connectee");
    const victimPassword = strongPassword();
    await createConfirmedUser(victimEmail, victimPassword);
    await signInThroughForm(page, victimEmail, victimPassword);
    await expectSignedIn(page, victimEmail);

    await page.goto(attackerLink);
    await expect(alert(page)).toContainText(victimEmail);
    await expect(page.getByRole("button", { name: "Confirmer mon adresse" })).toHaveCount(0);

    // La victime est toujours sur son propre compte.
    await page.goto("/fr/account");
    await expectSignedIn(page, victimEmail);
  });
});

test.describe("pages d'authentification", () => {
  for (const path of ["/fr/sign-in", "/fr/sign-up", "/fr/forgot-password"]) {
    test(`${path} n'est pas indexée et respecte la CSP`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await page.waitForLoadState("networkidle");
      expect(errors.filter((error) => error.includes("Content Security Policy"))).toEqual([]);
    });
  }
});
