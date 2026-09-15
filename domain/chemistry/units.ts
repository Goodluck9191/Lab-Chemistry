/**
 * Small, reliable unit system for the chemistry domain.
 *
 * MANUAL BASIS: the practical manual works in mL/cm^3, L/dm^3, mol, g and
 * mol/dm^3 throughout (e.g. Experiment 2: 50 mL burette, ~25.00 mL aliquots,
 * 0.6 g KHP, ~0.2 M NaOH). This module only models those units explicitly so
 * a volume can never silently mean "mL or L, whichever".
 *
 * Design: quantities carry their unit in the type (`Volume`, `Mass`,
 * `Moles`, `Molarity`), and every conversion is an explicit, tested function.
 * No ambient "assume mL" behaviour exists anywhere in the domain.
 */

export type VolumeUnit = "mL" | "L";
export type MassUnit = "g" | "mg";
export type AmountUnit = "mol" | "mmol";
export type MolarityUnit = "mol/L" | "mmol/mL" | "g/L";

export interface Volume {
  readonly value: number;
  readonly unit: VolumeUnit;
}

export interface Mass {
  readonly value: number;
  readonly unit: MassUnit;
}

export interface Amount {
  readonly value: number;
  readonly unit: AmountUnit;
}

export const ML_PER_L = 1000;
export const MG_PER_G = 1000;
export const MMOL_PER_MOL = 1000;

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${what} must be finite, got ${value}`);
  }
}

function assertNonNegative(value: number, what: string): void {
  assertFinite(value, what);
  if (value < 0) {
    throw new RangeError(`${what} must be >= 0, got ${value}`);
  }
}

/** mL -> L and back. */
export function volumeToL(volume: Volume): number {
  assertNonNegative(volume.value, "volume");
  return volume.unit === "L" ? volume.value : volume.value / ML_PER_L;
}

export function volumeToMl(volume: Volume): number {
  assertNonNegative(volume.value, "volume");
  return volume.unit === "mL" ? volume.value : volume.value * ML_PER_L;
}

/** g <-> mg. */
export function massToG(mass: Mass): number {
  assertNonNegative(mass.value, "mass");
  return mass.unit === "g" ? mass.value : mass.value / MG_PER_G;
}

export function massToMg(mass: Mass): number {
  assertNonNegative(mass.value, "mass");
  return mass.unit === "mg" ? mass.value : mass.value * MG_PER_G;
}

/** mol <-> mmol. */
export function amountToMol(amount: Amount): number {
  assertNonNegative(amount.value, "amount");
  return amount.unit === "mol" ? amount.value : amount.value / MMOL_PER_MOL;
}

export function amountToMmol(amount: Amount): number {
  assertNonNegative(amount.value, "amount");
  return amount.unit === "mmol" ? amount.value : amount.value * MMOL_PER_MOL;
}

/**
 * Normalise any supported molarity unit to mol/L.
 * "mmol/mL" is numerically identical to "mol/L" but accepted explicitly
 * because students mix the two; "g/L" requires the solute molar mass.
 */
export function molarityToMolPerL(
  value: number,
  unit: MolarityUnit,
  molarMassGPerMol?: number,
): number {
  assertNonNegative(value, "molarity");
  switch (unit) {
    case "mol/L":
    case "mmol/mL":
      return value;
    case "g/L": {
      if (molarMassGPerMol === undefined || !(molarMassGPerMol > 0)) {
        throw new RangeError("g/L conversion requires a positive molar mass");
      }
      return value / molarMassGPerMol;
    }
  }
}

/** mol/L -> g/L for reporting (e.g. "concentration in g/dm^3" questions). */
export function molarityToGramsPerL(molarityMolPerL: number, molarMassGPerMol: number): number {
  assertNonNegative(molarityMolPerL, "molarity");
  if (!(molarMassGPerMol > 0)) {
    throw new RangeError("molar mass must be positive");
  }
  return molarityMolPerL * molarMassGPerMol;
}

/** Round to a fixed number of decimal places (burette: 2, balance: 2, etc.). */
export function roundTo(value: number, decimalPlaces: number): number {
  assertFinite(value, "value");
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 12) {
    throw new RangeError(`decimalPlaces must be an integer 0..12, got ${decimalPlaces}`);
  }
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}
