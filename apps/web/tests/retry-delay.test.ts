import { describe, expect, it } from "vitest";
import { RETRY_BASE_MS, RETRY_MAX_MS, retryDelay } from "@/lib/offline/retry";

// ADR-0012 : reprise de l'enregistrement après une coupure.
describe("délai de reprise", () => {
  const middle = () => 0.5; // aucun aléa

  it("double à chaque échec, à partir du délai de base", () => {
    expect([1, 2, 3, 4].map((failures) => retryDelay(failures, middle))).toEqual([
      RETRY_BASE_MS,
      RETRY_BASE_MS * 2,
      RETRY_BASE_MS * 4,
      RETRY_BASE_MS * 8,
    ]);
  });

  it("ne dépasse jamais le plafond, même après de très nombreux échecs", () => {
    for (const failures of [5, 6, 20, 1_000, Number.MAX_SAFE_INTEGER]) {
      expect(retryDelay(failures, middle)).toBe(RETRY_MAX_MS);
      expect(retryDelay(failures, () => 0.999999)).toBe(RETRY_MAX_MS);
    }
  });

  it("ne décroît pas quand les échecs s'accumulent", () => {
    const delays = Array.from({ length: 12 }, (_, index) => retryDelay(index + 1, middle));
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });

  it("reste à un cinquième du délai nominal, en plus ou en moins", () => {
    expect(retryDelay(1, () => 0)).toBe(RETRY_BASE_MS * 0.8);
    expect(retryDelay(1, () => 0.999999)).toBeLessThanOrEqual(RETRY_BASE_MS * 1.2);
    expect(retryDelay(1, () => 0.999999)).toBeGreaterThan(RETRY_BASE_MS);
  });

  it("traite une valeur absurde comme un premier échec", () => {
    for (const failures of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1.9]) {
      expect(retryDelay(failures, middle)).toBe(RETRY_BASE_MS);
    }
  });

  it("n'est jamais nul : un serveur en panne n'est pas sollicité en boucle", () => {
    for (let failures = 1; failures < 30; failures += 1) {
      expect(retryDelay(failures)).toBeGreaterThanOrEqual(RETRY_BASE_MS * 0.8);
    }
  });
});
