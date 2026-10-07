import { describe, expect, it } from "vitest";
import { buildNotice, NOTICE_KINDS } from "@/lib/mail/notices";

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
