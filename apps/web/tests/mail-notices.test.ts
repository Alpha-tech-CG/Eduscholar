import { describe, expect, it } from "vitest";
import { buildInvitation, buildNotice, NOTICE_KINDS } from "@/lib/mail/notices";
import { transportOptions } from "@/lib/mail/transport";

describe("avis de sécurité envoyés par l'application", () => {
  it.each(NOTICE_KINDS)("« %s » est bilingue et ne porte ni lien ni code", (kind) => {
    const { subject, text, html } = buildNotice(kind);

    expect(subject).toMatch(/^EduScholar — .+ \/ .+$/);
    for (const body of [text, html]) {
      expect(body).toContain("Bonjour,");
      expect(body).toContain("Hello,");
      expect(body).toContain("ni lien ni code");
      expect(body).not.toMatch(/https?:\/\//i);
      expect(body).not.toContain("@");
    }
    expect(html).not.toMatch(/href\s*=/i);
    expect(html).not.toMatch(/<script|<img|<a\b/i);
    // Ni code, ni empreinte : les couleurs des styles mises à part.
    expect(html.replace(/style="[^"]*"/g, "")).not.toMatch(/\d{6,}|[0-9a-f]{20,}/i);
  });

  it("chaque avis a son propre objet", () => {
    expect(new Set(NOTICE_KINDS.map((kind) => buildNotice(kind).subject)).size).toBe(NOTICE_KINDS.length);
  });
});

describe("connexion au serveur d'envoi", () => {
  it("exige le chiffrement hors de la boîte locale", () => {
    const fictif = ["smtp://envoi", "exemple.invalid:587"].join(".");
    expect(transportOptions(fictif)).toMatchObject({ secure: false, requireTLS: true, port: 587 });
    expect(transportOptions("smtps://envoi.exemple.invalid")).toMatchObject({
      secure: true,
      requireTLS: false,
      port: 465,
    });
  });

  it("ne joint sans chiffrement que la machine elle-même", () => {
    expect(transportOptions("smtp://127.0.0.1:55319")).toMatchObject({ requireTLS: false, port: 55319 });
    expect(transportOptions("smtp://localhost:1025").requireTLS).toBe(false);
    expect(transportOptions("smtp://10.0.0.5:1025").requireTLS).toBe(true);
  });

  it("ne porte d'identifiants que s'ils sont fournis", () => {
    expect(transportOptions("smtp://127.0.0.1:1025").auth).toBeUndefined();
  });
});

describe("invitation à suivre un projet", () => {
  const link = `https://plateforme.exemple.invalid/fr/invitations/${"ab".repeat(32)}`;

  it("porte un seul lien, celui de la plateforme, dans les deux langues", () => {
    const { subject, text, html } = buildInvitation(link, "etudiante@exemple.invalid");
    expect(subject).toContain("Invitation");
    expect(text.split(link).length - 1).toBe(2);
    expect(html.match(/href="/g)).toHaveLength(2);
    expect(html.split(`href="${link}"`).length - 1).toBe(2);
    expect(html).toContain("etudiante@exemple.invalid vous invite");
    expect(html).not.toMatch(/<script|<img/i);
  });

  it("ne reprend pas une adresse façonnée pour passer pour un lien ou un autre message", () => {
    for (const forged of [
      'a"><b>x</b>@exemple.invalid',
      "www.exemple.invalid/eduscholar@exemple.invalid",
      "www.piege@exemple.invalid",
      "cliquez ici@exemple.invalid",
      "a%2Fb@exemple.invalid",
    ]) {
      const { html, text } = buildInvitation(link, forged);
      expect(html, forged).not.toContain(forged.split("@")[0]);
      expect(text, forged).toContain("Vous êtes invité");
    }
  });

  it("se passe de l'adresse de la personne qui invite", () => {
    const { text } = buildInvitation(link, null);
    expect(text).toContain("Vous êtes invité");
    expect(text).toContain("You are invited");
  });
});
