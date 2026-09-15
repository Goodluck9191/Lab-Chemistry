import { describe, expect, it } from "vitest";
import {
  averageTwoClosest,
  evaluateMolarityConcordance,
  evaluateTitreConcordance,
} from "@/domain/simulation/titration/trials";

describe("concordance", () => {
  it("passes molarities within the manual 0.005 M rule", () => {
    const result = evaluateMolarityConcordance([0.201, 0.203, 0.204], 0.005);
    expect(result.concordant).toBe(true);
    expect(result.spread).toBeCloseTo(0.003, 6);
  });

  it("fails molarities spread wider than 0.005 M (fourth titration needed)", () => {
    const result = evaluateMolarityConcordance([0.2, 0.203, 0.209], 0.005);
    expect(result.concordant).toBe(false);
  });

  it("supports the generic titre-volume mode (e.g. 0.1 mL)", () => {
    expect(evaluateTitreConcordance([12.4, 12.45, 12.5], 0.1, 2).concordant).toBe(true);
    expect(evaluateTitreConcordance([12.4, 12.6, 12.9], 0.1, 2).concordant).toBe(false);
  });

  it("averages the two closest molarities (manual Part II rule)", () => {
    expect(averageTwoClosest([0.2, 0.201, 0.209])).toBeCloseTo(0.2005, 6);
    expect(averageTwoClosest([0.19])).toBeCloseTo(0.19, 6);
  });
});
