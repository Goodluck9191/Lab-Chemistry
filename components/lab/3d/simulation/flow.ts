/**
 * Deterministic flow helpers for the 3D titration interaction.
 *
 * AUTHORITY BOUNDARY — read carefully. The domain engine remains the only
 * place that converts a delivered volume into chemistry (flask colour,
 * endpoint judgement, concordance). What these helpers do is let the 3D
 * stopcock behave like a real tap:
 *
 *   stopcock open + time elapses  →  a delivered volume accumulates
 *   stopcock closed               →  the accumulated volume is sent to the
 *                                    server as ONE `add_titrant` action
 *
 * Choosing the volume this way is no more authority than the existing
 * "deliver 1.00 mL" buttons: the client picks a volume, the server validates
 * it against capacity and computes the colour. The client never determines the
 * endpoint, the concentration or the grade.
 *
 * Pure, dependency-free, fully tested. Rates are visual/animation constants,
 * volumes are quantized to the burette graduation so a 3D delivery is
 * indistinguishable from a panel delivery in the persisted trial.
 */

export type FlowMode = "FAST" | "MEDIUM" | "DROPWISE";

export interface FlowModeSpec {
  mode: FlowMode;
  /** Short student-facing label. */
  label: string;
  /** Visual delivery rate while the stopcock stands open, mL per second. */
  mlPerSecond: number;
  /** Multiple of the burette graduation one "unit" of this mode delivers. */
  graduationMultiple: number;
}

export const FLOW_MODES: Record<FlowMode, FlowModeSpec> = {
  FAST: { mode: "FAST", label: "Fast stream", mlPerSecond: 2.0, graduationMultiple: 10 },
  MEDIUM: { mode: "MEDIUM", label: "Steady flow", mlPerSecond: 0.8, graduationMultiple: 1 },
  DROPWISE: { mode: "DROPWISE", label: "Dropwise", mlPerSecond: 0.15, graduationMultiple: 0.5 },
};

/** Volume accumulated over `deltaSeconds` at `rateMlPerSecond`. Pure. */
export function volumeTransferredMl(rateMlPerSecond: number, deltaSeconds: number): number {
  if (!(rateMlPerSecond > 0) || !(deltaSeconds > 0)) return 0;
  return rateMlPerSecond * deltaSeconds;
}

/**
 * Quantize a raw accumulated volume to whole dropwise units (half a
 * graduation), so the `add_titrant` action the 3D interaction sends carries a
 * clean value the engine treats exactly like a panel increment.
 */
export function quantizeDeliveryMl(rawMl: number, graduationMl: number): number {
  if (!(rawMl > 0) || !(graduationMl > 0)) return 0;
  const unit = graduationMl / 2;
  return Math.round(rawMl / unit) * unit;
}

export interface FlowAccumulation {
  /** Raw accumulated volume since the stopcock opened, in mL. */
  rawMl: number;
  /** Quantized volume that would be sent on close, in mL. */
  quantizedMl: number;
  /** True when the burette would run past its remaining contents. */
  buretteEmpty: boolean;
  /** True when the accumulation hit the protocol ceiling (60 mL per action). */
  protocolCapped: boolean;
}

/** Maximum `add_titrant` volume the protocol schema accepts per action. */
export const MAX_DELIVERY_PER_ACTION_ML = 60;

/**
 * Advance one flow tick. Deterministic: same inputs, same outputs — no random
 * numbers, no browser-invented final amount. The caller owns the clock (see
 * `simulationClock.ts`); this function only does the arithmetic.
 */
export function accumulateFlowTick(args: {
  alreadyAccumulatedMl: number;
  deltaSeconds: number;
  mode: FlowMode;
  graduationMl: number;
  buretteRemainingMl: number;
}): FlowAccumulation {
  const rate = FLOW_MODES[args.mode].mlPerSecond;
  const rawMl = args.alreadyAccumulatedMl + volumeTransferredMl(rate, args.deltaSeconds);
  const cappedRaw = Math.min(rawMl, MAX_DELIVERY_PER_ACTION_ML);
  return {
    rawMl: cappedRaw,
    quantizedMl: quantizeDeliveryMl(cappedRaw, args.graduationMl),
    buretteEmpty: cappedRaw >= args.buretteRemainingMl,
    protocolCapped: rawMl >= MAX_DELIVERY_PER_ACTION_ML,
  };
}

/**
 * Whether the flow loop must stop right now: stopcock closed, burette
 * exhausted, receiving vessel moved away, or the trial became invalid. The
 * caller evaluates the vessel/trial conditions from public state; this helper
 * keeps the stop rule in one tested place.
 */
export function shouldStopFlow(args: {
  stopcockOpen: boolean;
  buretteRemainingMl: number;
  receiverInPosition: boolean;
  trialOpen: boolean;
}): boolean {
  return (
    !args.stopcockOpen ||
    args.buretteRemainingMl <= 0 ||
    !args.receiverInPosition ||
    !args.trialOpen
  );
}
