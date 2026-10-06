import { describe, expect, it } from "vitest";
import { hasSameOrigin, isSameSiteRequest } from "@/lib/security/request-origin";

const request = (headers: Record<string, string>) =>
  new Request("https://app.example/fr/account/export/download", { method: "POST", headers });

describe("origine d'une requête d'export", () => {
  it("admet une requête dont l'origine est l'hôte visé", () => {
    expect(hasSameOrigin(request({ origin: "https://app.example", host: "app.example" }))).toBe(true);
    expect(hasSameOrigin(request({ origin: "http://localhost:3100", host: "localhost:3100" }))).toBe(true);
    // Derrière un proxy, l'hôte public est transmis.
    expect(
      hasSameOrigin(
        request({ origin: "https://app.example", host: "interne:3000", "x-forwarded-host": "app.example" }),
      ),
    ).toBe(true);
  });

  it("refuse une autre origine, un autre port, une origine illisible", () => {
    for (const origin of [
      "https://evil.example",
      "https://app.example.evil.example",
      "https://app.example:8443",
      "null",
      "pas une adresse",
    ]) {
      expect(hasSameOrigin(request({ origin, host: "app.example" })), origin).toBe(false);
    }
    expect(hasSameOrigin(request({ origin: "https://app.example" }))).toBe(false);
  });

  it("sans en-tête Origin, n'admet qu'une requête certifiée de même origine", () => {
    expect(hasSameOrigin(request({ host: "app.example" }))).toBe(false);
    expect(hasSameOrigin(request({ host: "app.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(hasSameOrigin(request({ host: "app.example", "sec-fetch-site": "none" }))).toBe(false);
    expect(hasSameOrigin(request({ host: "app.example", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
});

describe("téléchargement par navigation", () => {
  it("refuse ce qui vient d'un autre site, admet le reste", () => {
    expect(isSameSiteRequest(request({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameSiteRequest(request({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameSiteRequest(request({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameSiteRequest(request({ "sec-fetch-site": "none" }))).toBe(true);
    expect(isSameSiteRequest(request({}))).toBe(true);
  });
});
