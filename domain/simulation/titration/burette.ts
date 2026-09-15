/**
 * Burette domain model. No visuals — arithmetic and validity only.
 *
 * MANUAL BASIS (Expt 2): 50 mL burette; readings recorded to two decimal
 * places within ±0.02 mL; initial reading need not be exactly zero.
 */
import { roundTo } from "@/domain/chemistry/units";
import type { BuretteConfig } from "./config";

export interface BuretteReading {
  /** mL on the burette scale, 0..capacity. */
  readonly valueMl: number;
}

export type BuretteErrorCode =
  | "NEGATIVE_READING"
  | "READING_ABOVE_CAPACITY"
  | "FINAL_BELOW_INITIAL"
  | "DELIVERY_EXCEEDS_CAPACITY"
  | "INVALID_PRECISION";

export class BuretteError extends Error {
  readonly code: BuretteErrorCode;
  constructor(code: BuretteErrorCode, message: string) {
    super(message);
    this.name = "BuretteError";
    this.code = code;
  }
}

export function validateReading(config: BuretteConfig, valueMl: number): BuretteReading {
  if (!Number.isFinite(valueMl)) {
    throw new BuretteError("INVALID_PRECISION", "burette reading must be finite");
  }
  if (valueMl < 0) {
    throw new BuretteError("NEGATIVE_READING", `reading ${valueMl} mL is below zero`);
  }
  if (valueMl > config.capacityMl) {
    throw new BuretteError(
      "READING_ABOVE_CAPACITY",
      `reading ${valueMl} mL exceeds ${config.capacityMl} mL capacity`,
    );
  }
  return { valueMl: roundTo(valueMl, 2) };
}

/** Delivered volume = final - initial. Rejects negative delivery. */
export function deliveredVolumeMl(
  config: BuretteConfig,
  initialMl: number,
  finalMl: number,
): number {
  const initial = validateReading(config, initialMl);
  const final = validateReading(config, finalMl);
  const delivered = roundTo(final.valueMl - initial.valueMl, 2);
  if (delivered < 0) {
    throw new BuretteError(
      "FINAL_BELOW_INITIAL",
      `final ${finalMl} mL is below initial ${initialMl} mL`,
    );
  }
  if (delivered > config.maxDeliveredMl) {
    throw new BuretteError(
      "DELIVERY_EXCEEDS_CAPACITY",
      `delivery ${delivered} mL exceeds max ${config.maxDeliveredMl} mL`,
    );
  }
  return delivered;
}

/** A delivered titre that would need refilling mid-trial is invalid. */
export function titreFitsBurette(config: BuretteConfig, initialMl: number, titreMl: number): boolean {
  return initialMl + titreMl <= config.capacityMl + 1e-9;
}
