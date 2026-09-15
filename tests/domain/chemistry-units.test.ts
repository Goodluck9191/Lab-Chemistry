import { describe, expect, it } from "vitest";
import {
  amountToMmol,
  amountToMol,
  massToG,
  massToMg,
  molarityToGramsPerL,
  molarityToMolPerL,
  roundTo,
  volumeToL,
  volumeToMl,
} from "@/domain/chemistry/units";

describe("units", () => {
  it("converts 1000 mL to 1 L and back", () => {
    expect(volumeToL({ value: 1000, unit: "mL" })).toBeCloseTo(1, 12);
    expect(volumeToMl({ value: 1, unit: "L" })).toBeCloseTo(1000, 12);
    expect(volumeToMl({ value: 25, unit: "mL" })).toBe(25);
  });

  it("converts mol/mmmol and g/mg", () => {
    expect(amountToMol({ value: 1000, unit: "mmol" })).toBeCloseTo(1, 12);
    expect(amountToMmol({ value: 0.002, unit: "mol" })).toBeCloseTo(2, 12);
    expect(massToG({ value: 600, unit: "mg" })).toBeCloseTo(0.6, 12);
    expect(massToMg({ value: 0.6, unit: "g" })).toBeCloseTo(600, 12);
  });

  it("normalises molarity units, requiring molar mass for g/L", () => {
    expect(molarityToMolPerL(0.2, "mol/L")).toBe(0.2);
    expect(molarityToMolPerL(0.2, "mmol/mL")).toBe(0.2);
    expect(molarityToMolPerL(40, "g/L", 40)).toBeCloseTo(1, 12);
    expect(() => molarityToMolPerL(40, "g/L")).toThrow(RangeError);
    expect(molarityToGramsPerL(0.2, 40)).toBeCloseTo(8, 12);
  });

  it("rejects negative and non-finite quantities", () => {
    expect(() => volumeToL({ value: -1, unit: "mL" })).toThrow(RangeError);
    expect(() => volumeToMl({ value: Number.NaN, unit: "mL" })).toThrow(RangeError);
    expect(() => massToG({ value: Number.POSITIVE_INFINITY, unit: "g" })).toThrow(RangeError);
    expect(() => molarityToMolPerL(-0.1, "mol/L")).toThrow(RangeError);
  });

  it("rounds to the requested precision", () => {
    expect(roundTo(12.345, 2)).toBe(12.35);
    expect(roundTo(0.005, 2)).toBe(0.01);
    expect(() => roundTo(1, -1)).toThrow(RangeError);
  });
});
