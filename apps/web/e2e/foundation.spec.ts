import { expect, test } from "@playwright/test";

test.describe("langues", () => {
  test("la racine redirige vers une langue prise en charge", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(fr|en|pt)$/);
  });

  test("le français et l'anglais sont servis avec la bonne langue", async ({
    page,
  }) => {
    await page.goto("/fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Trouver, organiser, produire.")).toBeVisible();

    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("Find, organise, produce.")).toBeVisible();
  });

  test("le sélecteur de langue change de langue", async ({ page }) => {
    await page.goto("/fr");
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("une adresse inconnue affiche la page 404 traduite", async ({
    page,
  }) => {
    const response = await page.goto("/fr/adresse-inexistante");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page introuvable")).toBeVisible();
  });
});

test.describe("en-têtes de sécurité", () => {
  test("la page porte une CSP stricte avec nonce", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    const response = await page.goto("/fr");
    const csp = response?.headers()["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");

    // Aucun script ni style n'est bloqué par la CSP.
    await page.waitForLoadState("networkidle");
    expect(errors.filter((e) => e.includes("Content Security Policy"))).toEqual(
      [],
    );
  });

  test("le nonce change à chaque requête", async ({ request }) => {
    const nonce = async () => {
      const response = await request.get("/fr");
      return /'nonce-([^']+)'/.exec(
        response.headers()["content-security-policy"] ?? "",
      )?.[1];
    };
    const [first, second] = [await nonce(), await nonce()];
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  test("les en-têtes statiques sont présents", async ({ request }) => {
    const headers = (await request.get("/fr")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["permissions-policy"]).toBeTruthy();
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

test.describe("couverture du proxy", () => {
  const nonce = /script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/;

  for (const path of ["/fr/a.b", "/fr/doi/10.1000/xyz.123", "/fr/api-docs"]) {
    test(`${path} reçoit la CSP malgré le point ou le préfixe`, async ({
      request,
    }) => {
      const response = await request.get(path);
      expect(response.headers()["content-security-policy"]).toMatch(nonce);
    });
  }

  test("une requête marquée comme préchargement reçoit la CSP", async ({
    request,
  }) => {
    const response = await request.get("/fr", {
      headers: { Purpose: "prefetch", "Next-Router-Prefetch": "1" },
    });
    expect(response.headers()["content-security-policy"]).toMatch(nonce);
  });

  test("une adresse inconnue en anglais reste en anglais", async ({ page }) => {
    await page.goto("/en/unknown.page");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("une route d'API inexistante reçoit la CSP de repli", async ({
    request,
  }) => {
    const headers = (await request.get("/api/inexistante")).headers();
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("l'hôte annoncé par la requête n'est repris dans aucun en-tête", async ({
    request,
  }) => {
    const response = await request.get("/fr", {
      headers: { "X-Forwarded-Host": "evil.example" },
    });
    expect(JSON.stringify(response.headers())).not.toContain("evil.example");
  });

  test("une page n'est pas mise en cache de façon partagée", async ({
    request,
  }) => {
    const cacheControl =
      (await request.get("/fr")).headers()["cache-control"] ?? "";
    expect(cacheControl).not.toContain("public");
    expect(cacheControl).not.toContain("s-maxage");
  });
});

test.describe("accessibilité de base", () => {
  test("le lien d'évitement est le premier élément atteint au clavier", async ({
    page,
  }) => {
    await page.goto("/fr");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
  });

  test("aucun défilement horizontal sur petit écran", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/fr");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
