import { describe, expect, it } from "vitest";
import { DEFAULT_PAUSE_SECONDS, pauseSeconds } from "@/lib/connectors/retry-after";

describe("délai demandé par une source", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");

  it("lit un nombre de secondes", () => {
    expect(pauseSeconds("120", now)).toBe(120);
    expect(pauseSeconds(" 900 ", now)).toBe(900);
  });

  it("lit une date HTTP", () => {
    expect(pauseSeconds("Wed, 07 Oct 2026 12:10:00 GMT", now)).toBe(600);
  });

  it("borne le délai entre une minute et une heure", () => {
    expect(pauseSeconds("1", now)).toBe(60);
    expect(pauseSeconds("0", now)).toBe(60);
    expect(pauseSeconds("86400", now)).toBe(3600);
    expect(pauseSeconds("Wed, 07 Oct 2026 11:00:00 GMT", now)).toBe(60);
    expect(pauseSeconds("Thu, 08 Oct 2026 12:00:00 GMT", now)).toBe(3600);
  });

  it("retient cinq minutes quand l'en-tête manque ou ne se lit pas", () => {
    expect(pauseSeconds(null, now)).toBe(DEFAULT_PAUSE_SECONDS);
    expect(pauseSeconds("", now)).toBe(DEFAULT_PAUSE_SECONDS);
    expect(pauseSeconds("bientôt", now)).toBe(DEFAULT_PAUSE_SECONDS);
    expect(pauseSeconds("-5", now)).toBe(DEFAULT_PAUSE_SECONDS);
    expect(pauseSeconds("1e9", now)).toBe(DEFAULT_PAUSE_SECONDS);
    expect(pauseSeconds("9".repeat(60), now)).toBe(DEFAULT_PAUSE_SECONDS);
  });
});
