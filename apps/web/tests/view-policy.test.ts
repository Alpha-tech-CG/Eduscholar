import { describe, expect, it } from "vitest";
import { shouldRecordView } from "@/lib/library/view-policy";

const headers = (values: Record<string, string>) => new Headers(values);

describe("enregistrement d'une consultation (revue FAIBLE-1, FAIBLE-2)", () => {
  it("enregistre une navigation du site, une adresse saisie, ou sans en-tête", () => {
    expect(shouldRecordView(headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(shouldRecordView(headers({ "sec-fetch-site": "none" }))).toBe(true);
    expect(shouldRecordView(headers({}))).toBe(true);
  });

  it("n'enregistre pas une navigation venue d'un autre site", () => {
    expect(shouldRecordView(headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(shouldRecordView(headers({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("n'enregistre pas un préchargement", () => {
    expect(shouldRecordView(headers({ "sec-purpose": "prefetch" }))).toBe(false);
    expect(shouldRecordView(headers({ "sec-purpose": "prefetch;prerender", "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(shouldRecordView(headers({ purpose: "prefetch" }))).toBe(false);
  });
});
