import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const env = { PASSWORD_BREACH_CHECK: "1" as string | undefined };
vi.mock("@/lib/env.server", () => ({ serverEnv: () => env }));

const { isBreachedPassword, isSuffixListed, sha1Parts } = await import("@/lib/auth/breached-password");

describe("contrôle des mots de passe compromis", () => {
  const { prefix, suffix } = sha1Parts("exemple de phrase de passe");

  it("n'envoie que les cinq premiers caractères de l'empreinte", async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(`${suffix}:12
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3`);
    }) as typeof fetch;

    expect(await isBreachedPassword("exemple de phrase de passe", fetcher)).toBe(true);
    expect(seen).toEqual([`https://api.pwnedpasswords.com/range/${prefix}`]);
    expect(prefix).toHaveLength(5);
    expect(seen[0]).not.toContain(suffix);
    expect(seen[0]).not.toContain("exemple");
  });

  it("ne tient pas compte d'une ligne de remplissage, comptée zéro", () => {
    expect(isSuffixListed(`${suffix}:0`, suffix)).toBe(false);
    expect(isSuffixListed(`${suffix.toLowerCase()}:4`, suffix)).toBe(true);
    expect(isSuffixListed("", suffix)).toBe(false);
  });

  it("accepte le mot de passe quand le service ne répond pas", async () => {
    const failing = (async () => {
      throw new Error("réseau");
    }) as typeof fetch;
    const refusing = (async () => new Response("", { status: 503 })) as typeof fetch;
    expect(await isBreachedPassword("exemple de phrase de passe", failing)).toBe(false);
    expect(await isBreachedPassword("exemple de phrase de passe", refusing)).toBe(false);
  });

  it("ne fait aucun appel tant qu'il n'est pas activé", async () => {
    env.PASSWORD_BREACH_CHECK = undefined;
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response("");
    }) as typeof fetch;
    expect(await isBreachedPassword("exemple de phrase de passe", fetcher)).toBe(false);
    expect(called).toBe(false);
    env.PASSWORD_BREACH_CHECK = "1";
  });
});
