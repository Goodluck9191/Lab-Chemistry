/**
 * Meniscus / reading model: the student's observation is stored separately
 * from the hidden true value.
 *
 * MANUAL BASIS: colourless solutions are read at the bottom of the meniscus,
 * eye level with the surface; burette to ±0.02 mL; balance to ±0.01 g; acid
 * aliquot known to two decimals. Systematic mistakes (reading the top,
 * parallax, coarse rounding) surface here as classified errors, never as
 * silent corrections.
 */
import { roundTo } from "@/domain/chemistry/units";

export type ReadingKind = "burette" | "balance" | "aliquot";

export interface TrueReading {
  readonly kind: ReadingKind;
  /** Hidden true value in native units (mL for burette/aliquot, g for balance). */
  readonly trueValue: number;
  /** Smallest meaningful increment (0.02 mL burette, 0.01 g balance). */
  readonly precision: number;
}

export interface ObservedReading {
  readonly kind: ReadingKind;
  /** What the student recorded. */
  readonly observedValue: number;
  /** Signed error observed - true. */
  readonly error: number;
  readonly withinPrecision: boolean;
}

export function observeReading(trueReading: TrueReading, observedValue: number): ObservedReading {
  if (!Number.isFinite(observedValue)) {
    throw new RangeError("observed reading must be finite");
  }
  const observed = roundTo(observedValue, 2);
  const error = roundTo(observed - trueReading.trueValue, 4);
  return {
    kind: trueReading.kind,
    observedValue: observed,
    error,
    withinPrecision: Math.abs(error) <= trueReading.precision + 1e-9,
  };
}

export type ReadingQuality = "correct" | "slightly_wrong" | "poor_meniscus" | "gross_error";

/** Educational classification used by assessment, thresholds in native units. */
export function classifyReadingError(kind: ReadingKind, absoluteError: number): ReadingQuality {
  const e = Math.abs(absoluteError);
  if (kind === "burette" || kind === "aliquot") {
    if (e <= 0.02 + 1e-9) return "correct";
    if (e <= 0.1) return "slightly_wrong";
    if (e <= 0.3) return "poor_meniscus";
    return "gross_error";
  }
  if (e <= 0.01 + 1e-9) return "correct";
  if (e <= 0.05) return "slightly_wrong";
  if (e <= 0.2) return "poor_meniscus";
  return "gross_error";
}
