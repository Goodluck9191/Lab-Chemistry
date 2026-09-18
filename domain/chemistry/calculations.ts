/**
 * Pure chemistry calculation core. No React, Next.js, Supabase or browser APIs.
 *
 * MANUAL BASIS (Experiment 2, MUST NSCH 1103 Practical I, pp.16-21):
 * - Molarity M = moles / litre (manual states the formula explicitly).
 * - KHP (HKC8H4O4) titrated with NaOH, then standardised NaOH against HCl.
 * - General neutralisation HA + BOH -> H2O + BA, i.e. 1:1 for both stages.
 * The engine itself is stoichiometry-generic (a:b coefficients); the 1:1
 * values live in the Experiment 2 configuration, not here.
 */
import { amountToMol, molarityToMolPerL, volumeToL, type MolarityUnit } from "./units";

export interface Stoichiometry {
  /** Coefficient of the analyte in aA + bB -> products. Must be a positive integer. */
  readonly analyteCoefficient: number;
  /** Coefficient of the titrant. Must be a positive integer. */
  readonly titrantCoefficient: number;
}

export function assertStoichiometry(stoich: Stoichiometry): void {
  for (const [name, value] of [
    ["analyteCoefficient", stoich.analyteCoefficient],
    ["titrantCoefficient", stoich.titrantCoefficient],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive integer, got ${value}`);
    }
  }
}

function assertFinitePositive(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${what} must be a finite positive number, got ${value}`);
  }
}

function assertFiniteNonNegative(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${what} must be a finite non-negative number, got ${value}`);
  }
}

/**
 * Weighing by difference (Experiment 2 KHP procedure): the sample mass is the
 * second weighing minus the first. Throws when the second weighing does not
 * exceed the first, so nothing is silently added to the flask.
 */
export function massByDifference(fullG: number, emptyG: number): number {
  assertFinitePositive(fullG, "full mass");
  assertFinitePositive(emptyG, "empty mass");
  if (!(fullG > emptyG)) {
    throw new RangeError(
      `weighing by difference needs the second weighing to exceed the first, got ${fullG} g and ${emptyG} g`,
    );
  }
  return fullG - emptyG;
}

/** C = n / V. Volume is explicit so mL and L can never be confused. */
export function molarityFromMolesAndVolume(
  moles: number,
  volumeValue: number,
  volumeUnit: "mL" | "L",
): number {
  assertFiniteNonNegative(moles, "moles");
  const volumeL = volumeToL({ value: volumeValue, unit: volumeUnit });
  if (volumeL <= 0) {
    throw new RangeError("volume must be positive to compute molarity");
  }
  return moles / volumeL;
}

/** n = C x V. Accepts any molarity unit; g/L needs the molar mass. */
export function molesFromMolarityAndVolume(
  molarityValue: number,
  molarityUnit: MolarityUnit,
  volumeValue: number,
  volumeUnit: "mL" | "L",
  molarMassGPerMol?: number,
): number {
  const molarityMolPerL = molarityToMolPerL(molarityValue, molarityUnit, molarMassGPerMol);
  const volumeL = volumeToL({ value: volumeValue, unit: volumeUnit });
  return molarityMolPerL * volumeL;
}

/** m = n x M. */
export function massFromMolesAndMolarMass(moles: number, molarMassGPerMol: number): number {
  assertFiniteNonNegative(moles, "moles");
  assertFinitePositive(molarMassGPerMol, "molarMassGPerMol");
  return moles * molarMassGPerMol;
}

/** n = m / M. */
export function molesFromMassAndMolarMass(massG: number, molarMassGPerMol: number): number {
  assertFiniteNonNegative(massG, "massG");
  assertFinitePositive(molarMassGPerMol, "molarMassGPerMol");
  return massG / molarMassGPerMol;
}

/** Dilution C1V1 = C2V2: volume of stock needed to prepare the target. */
export function dilutionStockVolume(
  stockMolarityMolPerL: number,
  targetMolarityMolPerL: number,
  targetVolumeValue: number,
  targetVolumeUnit: "mL" | "L",
): { value: number; unit: "mL" | "L" } {
  assertFinitePositive(stockMolarityMolPerL, "stockMolarityMolPerL");
  assertFiniteNonNegative(targetMolarityMolPerL, "targetMolarityMolPerL");
  const targetL = volumeToL({ value: targetVolumeValue, unit: targetVolumeUnit });
  const stockL = (targetMolarityMolPerL * targetL) / stockMolarityMolPerL;
  return { value: stockL * 1000, unit: "mL" };
}

/**
 * Stoichiometry core: nA / a = nB / b.
 * Returns moles of analyte given moles of titrant delivered.
 */
export function analyteMolesFromTitrantMoles(
  titrantMoles: number,
  stoich: Stoichiometry,
): number {
  assertFiniteNonNegative(titrantMoles, "titrantMoles");
  assertStoichiometry(stoich);
  return (titrantMoles * stoich.analyteCoefficient) / stoich.titrantCoefficient;
}

/**
 * Generic titration calculation:
 *   moles titrant = C_titrant x V_titrant
 *   moles analyte = titrant moles x (a / b)
 *   C_analyte = moles analyte / V_analyte
 * All volumes carry explicit units; coefficients come from configuration.
 */
export function analyteConcentrationFromTitration(args: {
  titrantMolarityMolPerL: number;
  titrantVolumeValue: number;
  titrantVolumeUnit: "mL" | "L";
  analyteVolumeValue: number;
  analyteVolumeUnit: "mL" | "L";
  stoichiometry: Stoichiometry;
}): number {
  assertStoichiometry(args.stoichiometry);
  const titrantMoles = molesFromMolarityAndVolume(
    args.titrantMolarityMolPerL,
    "mol/L",
    args.titrantVolumeValue,
    args.titrantVolumeUnit,
  );
  const analyteMoles = analyteMolesFromTitrantMoles(titrantMoles, args.stoichiometry);
  const analyteVolumeL = volumeToL({
    value: args.analyteVolumeValue,
    unit: args.analyteVolumeUnit,
  });
  if (analyteVolumeL <= 0) {
    throw new RangeError("analyte volume must be positive");
  }
  return analyteMoles / analyteVolumeL;
}

/**
 * Equivalence (theoretical) titrant volume for a known analyte portion:
 *   V_titrant = (n_analyte x b / a) / C_titrant
 * Used by the engine to derive the hidden expected endpoint from the seed.
 */
export function equivalenceTitrantVolumeMl(args: {
  analyteMoles: number;
  titrantMolarityMolPerL: number;
  stoichiometry: Stoichiometry;
}): number {
  assertFiniteNonNegative(args.analyteMoles, "analyteMoles");
  assertFinitePositive(args.titrantMolarityMolPerL, "titrantMolarityMolPerL");
  assertStoichiometry(args.stoichiometry);
  const titrantMoles =
    (args.analyteMoles * args.stoichiometry.titrantCoefficient) /
    args.stoichiometry.analyteCoefficient;
  return (titrantMoles / args.titrantMolarityMolPerL) * 1000;
}

/** Convenience for Experiment 2 Part I: moles KHP from weighed mass. */
export function khpMolesFromMass(massG: number, khpMolarMassGPerMol: number): number {
  return molesFromMassAndMolarMass(massG, khpMolarMassGPerMol);
}

/** Re-export for callers that only need the amount helper. */
export { amountToMol };
