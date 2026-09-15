import { describe, expect, it } from "vitest";
import {
  BuretteError,
  deliveredVolumeMl,
  titreFitsBurette,
  validateReading,
} from "@/domain/simulation/titration/burette";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";

const burette = exp02TitrationConfig.stages[0].burette;

describe("burette model", () => {
  it("computes delivered volume as final minus initial", () => {
    expect(deliveredVolumeMl(burette, 0.0, 14.69)).toBeCloseTo(14.69, 2);
    expect(deliveredVolumeMl(burette, 1.05, 15.74)).toBeCloseTo(14.69, 2);
  });

  it("accepts a non-zero initial reading (manual: need not be exactly zero)", () => {
    expect(validateReading(burette, 2.35).valueMl).toBe(2.35);
  });

  it("rejects final below initial (negative delivery)", () => {
    expect(() => deliveredVolumeMl(burette, 15.0, 14.0)).toThrow(BuretteError);
    try {
      deliveredVolumeMl(burette, 15.0, 14.0);
    } catch (error) {
      expect((error as BuretteError).code).toBe("FINAL_BELOW_INITIAL");
    }
  });

  it("rejects readings above the 50 mL capacity and negative readings", () => {
    expect(() => validateReading(burette, 50.01)).toThrow(BuretteError);
    expect(() => validateReading(burette, -0.5)).toThrow(BuretteError);
  });

  it("detects titres that would need a mid-trial refill", () => {
    expect(titreFitsBurette(burette, 40, 15)).toBe(false);
    expect(titreFitsBurette(burette, 0, 15)).toBe(true);
  });
});
