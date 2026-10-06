import { describe, expect, it } from "vitest";
import {
  clientAddress,
  normalizeAddress,
  trustedIpHeader,
  UNTRUSTED_SOURCE,
} from "@/lib/auth/client-address";
import { isRecoveryMethodList, RECOVERY_WINDOW_SECONDS } from "@/lib/auth/recovery";
import {
  DEFAULT_AFTER_SIGN_IN,
  nextAfterVerification,
  safeNextPath,
} from "@/lib/auth/redirect";
import { parseSignInNotice } from "@/lib/auth/state";
import { isSessionCookie, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/supabase/cookies";

const headersOf = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

// Modèle de menaces M-01 : la limitation de débit ne doit pas reposer sur un
// en-tête que le client choisit.
describe("adresse du client", () => {
  it("n'accorde aucune confiance à x-forwarded-for par défaut", () => {
    const headers = headersOf({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" });
    expect(clientAddress(headers, {})).toBe(UNTRUSTED_SOURCE);
  });

  it("sur Vercel, lit l'en-tête posé par la plateforme et ignore celui du client", () => {
    const env = { VERCEL: "1" };
    const headers = headersOf({
      "x-forwarded-for": "198.51.100.1",
      "x-vercel-forwarded-for": "203.0.113.7",
    });
    expect(trustedIpHeader(env)).toBe("x-vercel-forwarded-for");
    expect(clientAddress(headers, env)).toBe("203.0.113.7");
  });

  it("ailleurs, lit l'en-tête de confiance configuré, dernier saut", () => {
    const env = { TRUSTED_CLIENT_IP_HEADER: "X-Real-Client" };
    const headers = headersOf({ "x-real-client": "198.51.100.1, 203.0.113.7" });
    expect(clientAddress(headers, env)).toBe("203.0.113.7");
  });

  it("revient à la clé commune si l'en-tête de confiance est absent ou illisible", () => {
    const env = { TRUSTED_CLIENT_IP_HEADER: "x-real-client" };
    expect(clientAddress(headersOf({}), env)).toBe(UNTRUSTED_SOURCE);
    expect(clientAddress(headersOf({ "x-real-client": "<script>" }), env)).toBe(UNTRUSTED_SOURCE);
  });

  it("refuse un nom d'en-tête de confiance invalide", () => {
    expect(trustedIpHeader({ TRUSTED_CLIENT_IP_HEADER: "bad header\n" })).toBeNull();
  });

  it("regroupe les adresses IPv6 par préfixe /64", () => {
    expect(normalizeAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeAddress("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(normalizeAddress("2001:0db8:0001:0002::ffff")).toBe("2001:db8:1:2::/64");
    expect(normalizeAddress("[2001:db8:1:2::1]")).toBe("2001:db8:1:2::/64");
    expect(normalizeAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeAddress("pas une adresse")).toBeNull();
  });
});

// Le changement de mot de passe sans l'ancien est réservé à la session ouverte
// par un lien de réinitialisation récent.
describe("session de réinitialisation", () => {
  const now = 1_800_000_000_000;
  const seconds = now / 1000;

  it("accepte un lien par courriel utilisé à l'instant", () => {
    expect(isRecoveryMethodList([{ method: "otp", timestamp: seconds - 30 }], now)).toBe(true);
  });

  it("refuse une session ouverte par mot de passe", () => {
    expect(isRecoveryMethodList([{ method: "password", timestamp: seconds - 30 }], now)).toBe(false);
  });

  it("refuse un lien trop ancien", () => {
    const old = seconds - RECOVERY_WINDOW_SECONDS - 1;
    expect(isRecoveryMethodList([{ method: "otp", timestamp: old }], now)).toBe(false);
  });

  it("ne regarde que la méthode la plus récente", () => {
    const methods = [
      { method: "otp", timestamp: seconds - 600 },
      { method: "password", timestamp: seconds - 10 },
    ];
    expect(isRecoveryMethodList(methods, now)).toBe(false);
  });

  it.each([undefined, null, "otp", {}, [], [{ method: "otp" }], [{ timestamp: 1 }]])(
    "refuse une revendication absente ou mal formée : %j",
    (value) => {
      expect(isRecoveryMethodList(value, now)).toBe(false);
    },
  );

  it("reste valable après la saisie du second facteur", () => {
    const methods = [
      { method: "otp", timestamp: seconds - 120 },
      { method: "totp", timestamp: seconds - 10 },
    ];
    expect(isRecoveryMethodList(methods, now)).toBe(true);
  });

  it("n'est jamais accordée à une session ouverte par mot de passe, même avec un code", () => {
    const methods = [
      { method: "password", timestamp: seconds - 120 },
      { method: "totp", timestamp: seconds - 10 },
    ];
    expect(isRecoveryMethodList(methods, now)).toBe(false);
  });

  it("refuse un horodatage dans le futur", () => {
    expect(isRecoveryMethodList([{ method: "otp", timestamp: seconds + 3600 }], now)).toBe(false);
  });
});

describe("destination après connexion, cas limites", () => {
  it.each(["/fr//evil.example", "/en//evil.example", "/fr/fr//evil.example"])(
    "ne laisse pas un préfixe de langue masquer un hôte externe : %s",
    (value) => {
      const result = safeNextPath(value);
      expect(result.startsWith("//")).toBe(false);
      expect(result).toBe("/evil.example");
    },
  );

  it.each(["/fr/fr/sign-in", "/en/fr/auth/confirm"])(
    "ne renvoie pas vers une page d'authentification derrière deux préfixes : %s",
    (value) => {
      expect(safeNextPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
    },
  );

  it("réduit les barres obliques répétées", () => {
    expect(safeNextPath("/account///settings")).toBe("/account/settings");
  });
});

describe("message de la page de connexion", () => {
  it("n'accepte que les valeurs prévues", () => {
    expect(parseSignInNotice("email-confirmed")).toBe("email-confirmed");
    expect(parseSignInNotice("password-updated")).toBe("password-updated");
    expect(parseSignInNotice("<script>alert(1)</script>")).toBeNull();
    expect(parseSignInNotice(undefined)).toBeNull();
    expect(parseSignInNotice(["email-confirmed"])).toBeNull();
  });
});

describe("cookie de session", () => {
  it("est reconnu, morceaux compris, et rien d'autre", () => {
    expect(isSessionCookie(SESSION_COOKIE_NAME)).toBe(true);
    expect(isSessionCookie(`${SESSION_COOKIE_NAME}.0`)).toBe(true);
    expect(isSessionCookie(`${SESSION_COOKIE_NAME}-autre`)).toBe(false);
    expect(isSessionCookie("sb-quelconque-auth-token")).toBe(false);
  });

  it("n'est jamais rattaché à un domaine parent", () => {
    const options = sessionCookieOptions({ domain: ".exemple.org", maxAge: 60 });
    expect(options).not.toHaveProperty("domain");
    expect(options.path).toBe("/");
  });
});

describe("destination après la saisie du second facteur", () => {
  it("admet le choix d'un nouveau mot de passe, et rien d'autre de particulier", () => {
    expect(nextAfterVerification("/reset-password")).toBe("/reset-password");
    expect(nextAfterVerification("/account/security")).toBe("/account/security");
    expect(nextAfterVerification("/reset-password?x=1")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(nextAfterVerification("/fr/reset-password")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(nextAfterVerification("https://evil.example/")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(nextAfterVerification("/sign-in")).toBe(DEFAULT_AFTER_SIGN_IN);
  });
});
