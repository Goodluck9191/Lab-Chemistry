/**
 * Endpoint model: equivalence point vs observable endpoint.
 *
 * The equivalence point is the stoichiometric truth (hidden). The observable
 * endpoint is what the student sees: indicator colour change, possibly biased
 * past equivalence (overshoot tendency) plus noise. The engine NEVER reveals
 * the equivalence volume; it only answers "what colour is the flask now?".
 *
 * MANUAL BASIS (Expt 2): phenolphthalein, colourless -> faint pink persisting
 * 45-60 s; one-drop difference between colourless and pink; overshoot means
 * discard and repeat. No pH or transition range is stated, so none is modelled.
 */
import type { IndicatorConfig } from "./config";

export type FlaskColour = "colourless" | "faint_pink" | "pink" | "deep_pink";

export interface EndpointTruth {
  /** Hidden stoichiometric volume in mL. */
  readonly equivalenceMl: number;
  /** Hidden actually-observed change volume (equivalence + bias + noise). */
  readonly observableMl: number;
}

export function createEndpointTruth(
  equivalenceMl: number,
  biasMl: number,
  noiseMl: number,
): EndpointTruth {
  if (!(equivalenceMl > 0)) throw new RangeError("equivalence volume must be positive");
  const observableMl = Math.max(0, equivalenceMl + biasMl + noiseMl);
  return {
    equivalenceMl: Math.round(equivalenceMl * 100) / 100,
    observableMl: Math.round(observableMl * 100) / 100,
  };
}

export interface ColourObservation {
  readonly colour: FlaskColour;
  /** mL past the observable endpoint (<= 0 means not yet reached). */
  readonly pastEndpointMl: number;
}

/**
 * Colour ladder around the observable endpoint. One drop (~0.05 mL) separates
 * colourless from faint pink per the manual; generous excess goes deep pink.
 */
export function observeFlaskColour(
  _indicator: IndicatorConfig,
  deliveredMl: number,
  truth: EndpointTruth,
): ColourObservation {
  const past = deliveredMl - truth.observableMl;
  if (past < -0.05) return { colour: "colourless", pastEndpointMl: round2(past) };
  if (past <= 0.1) return { colour: "faint_pink", pastEndpointMl: round2(past) };
  if (past <= 0.5) return { colour: "pink", pastEndpointMl: round2(past) };
  return { colour: "deep_pink", pastEndpointMl: round2(past) };
}

export type EndpointJudgement = "correct" | "undertitrated" | "overshot";

/** Correct = stopped at faint pink (within one drop past observable). */
export function judgeEndpointStop(deliveredMl: number, truth: EndpointTruth): EndpointJudgement {
  const past = deliveredMl - truth.observableMl;
  if (past < -0.05) return "undertitrated";
  if (past <= 0.15) return "correct";
  return "overshot";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
