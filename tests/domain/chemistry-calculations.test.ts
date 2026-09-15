import { describe, expect, it } from "vitest";
import {
  analyteConcentrationFromTitration,
  analyteMolesFromTitrantMoles,
  dilutionStockVolume,
  equivalenceTitrantVolumeMl,
  massFromMolesAndMolarMass,
  molarityFromMolesAndVolume,
  molesFromMolarityAndVolume,
  molesFromMassAndMolarMass,
} from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";

describe("chemistry calculations", () => {
  it("computes molarity C = n / V with explicit units", () => {
    expect(molarityFromMolesAndVolume(0.005, 25, "mL")).toBeCloseTo(0.2, 12);
    expect(molarityFromMolesAndVolume(0.005, 0.025, "L")).toBeCloseTo(0.2, 12);
    expect(() => molarityFromMolesAndVolume(0.005, 0, "mL")).toThrow(RangeError);
  });

  it("computes moles n = C x V", () => {
    expect(molesFromMolarityAndVolume(0.2, "mol/L", 25, "mL")).toBeCloseTo(0.005, 12);
    expect(molesFromMolarityAndVolume(2, "mol/L", 100, "mL")).toBeCloseTo(0.2, 12);
  });

  it("computes mass m = n x M and moles from mass", () => {
    const moles = molesFromMassAndMolarMass(0.6, KHP_MOLAR_MASS_G_PER_MOL);
    expect(moles).toBeCloseTo(0.6 / 204.2223, 9);
    expect(massFromMolesAndMolarMass(moles, KHP_MOLAR_MASS_G_PER_MOL)).toBeCloseTo(0.6, 9);
  });

  it("solves dilution C1V1 = C2V2 (2M stock -> ~0.2M working)", () => {
    // 100 mL of 0.2 M from 2 M stock needs 10 mL of stock.
    const stock = dilutionStockVolume(2, 0.2, 100, "mL");
    expect(stock.unit).toBe("mL");
    expect(stock.value).toBeCloseTo(10, 9);
  });

  it("supports 1:1 stoichiometry (KHP/NaOH and HCl/NaOH)", () => {
    const analyte = analyteMolesFromTitrantMoles(0.005, {
      analyteCoefficient: 1,
      titrantCoefficient: 1,
    });
    expect(analyte).toBeCloseTo(0.005, 12);
    // CaVa = CbVb: 25 mL of 0.2 M NaOH standardises 25 mL of 0.2 M HCl.
    const c = analyteConcentrationFromTitration({
      titrantMolarityMolPerL: 0.2,
      titrantVolumeValue: 25,
      titrantVolumeUnit: "mL",
      analyteVolumeValue: 25,
      analyteVolumeUnit: "mL",
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 },
    });
    expect(c).toBeCloseTo(0.2, 12);
  });

  it("supports 1:2 stoichiometry", () => {
    // e.g. H2SO4 + 2 NaOH: 25 mL of 0.1 M acid needs 50 mL of 0.1 M base.
    const c = analyteConcentrationFromTitration({
      titrantMolarityMolPerL: 0.1,
      titrantVolumeValue: 50,
      titrantVolumeUnit: "mL",
      analyteVolumeValue: 25,
      analyteVolumeUnit: "mL",
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 2 },
    });
    expect(c).toBeCloseTo(0.1, 12);
  });

  it("supports 2:1 stoichiometry", () => {
    const analyte = analyteMolesFromTitrantMoles(0.01, {
      analyteCoefficient: 2,
      titrantCoefficient: 1,
    });
    expect(analyte).toBeCloseTo(0.02, 12);
  });

  it("derives the equivalence volume V = n/C", () => {
    // 0.6 g KHP (~2.938 mmol) against 0.2 M NaOH -> ~14.69 mL.
    const moles = molesFromMassAndMolarMass(0.6, KHP_MOLAR_MASS_G_PER_MOL);
    const v = equivalenceTitrantVolumeMl({
      analyteMoles: moles,
      titrantMolarityMolPerL: 0.2,
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 },
    });
    expect(v).toBeGreaterThan(10);
    expect(v).toBeLessThan(20);
  });

  it("rejects invalid stoichiometry and volumes", () => {
    expect(() =>
      analyteMolesFromTitrantMoles(1, { analyteCoefficient: 0, titrantCoefficient: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      analyteConcentrationFromTitration({
        titrantMolarityMolPerL: 0.2,
        titrantVolumeValue: 25,
        titrantVolumeUnit: "mL",
        analyteVolumeValue: 0,
        analyteVolumeUnit: "mL",
        stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 },
      }),
    ).toThrow(RangeError);
  });
});
