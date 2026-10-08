import { describe, expect, it } from "vitest";
import {
  apiContentSecurityPolicy,
  buildContentSecurityPolicy,
  generateNonce,
  staticSecurityHeaders,
} from "@/lib/security/headers";

function parse(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((directive) => {
      const [name = "", ...values] = directive.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

describe("Content-Security-Policy de production", () => {
  const csp = parse(buildContentSecurityPolicy("abc123", false));

  it("n'autorise ni script inline ni eval", () => {
    const scripts = csp.get("script-src") ?? [];
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("n'autorise aucun style inline sans nonce", () => {
    expect(csp.get("style-src")).toEqual(["'self'", "'nonce-abc123'"]);
  });

  it("interdit l'encadrement, les objets et le détournement de base ou de formulaire", () => {
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
  });

  it("limite toutes les autres sources à l'origine", () => {
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
  });

  it("ne contient aucune source générique", () => {
    const values = [...csp.values()].flat();
    expect(values).not.toContain("*");
    expect(values).not.toContain("https:");
    expect(values).not.toContain("http:");
  });
});

describe("Content-Security-Policy de développement", () => {
  it("ne relâche que ce qu'exigent React et le rechargement à chaud", () => {
    const csp = parse(buildContentSecurityPolicy("abc123", true));
    expect(csp.get("script-src")).toContain("'unsafe-eval'");
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });
});

describe("nonce", () => {
  it("est différent à chaque requête", () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
  });
});

describe("en-têtes statiques", () => {
  const headers = new Map(
    staticSecurityHeaders.map(({ key, value }) => [key.toLowerCase(), value]),
  );

  it("couvre les en-têtes exigés par le modèle de menaces (M-46)", () => {
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.has("permissions-policy")).toBe(true);
  });
});

describe("CSP de repli des routes d'API", () => {
  it("n'autorise aucune source", () => {
    expect(apiContentSecurityPolicy).toContain("default-src 'none'");
    expect(apiContentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(apiContentSecurityPolicy).toContain("sandbox");
  });
});

describe("Content-Security-Policy et défi anti-robot", () => {
  it("n'admet aucun cadre tant que le défi n'est pas configuré", () => {
    const csp = parse(buildContentSecurityPolicy("abc123", false));
    expect(csp.get("frame-src")).toEqual(["'none'"]);
    expect(csp.get("script-src")?.join(" ")).not.toContain("cloudflare");
  });

  it("n'admet, une fois configuré, que l'origine du défi", () => {
    const csp = parse(buildContentSecurityPolicy("abc123", false, true));
    expect(csp.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(csp.get("script-src")).toContain("https://challenges.cloudflare.com");
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });
});
