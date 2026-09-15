/**
 * Trial manager + concordance evaluator + educational error events.
 *
 * MANUAL BASIS (Expt 2):
 * - Repeat three times; if molarities spread > 0.005 M, do a fourth.
 * - Average the acid molarity from the two closest values (Part II).
 * - Overshoot -> discard the flask and repeat (trial rejected, not fatal).
 * - Concordant titres for precipitation work elsewhere agree within 0.1 mL;
 *   that rule is NOT Expt 2's rule and is kept as the generic titre_volume
 *   mode for other configurations.
 */
import { roundTo } from "@/domain/chemistry/units";
import type { TrialRules } from "./config";

export type TrialStatus = "open" | "recorded" | "rejected" | "discarded_overshoot";

export interface TrialRecord {
  readonly trialNumber: number;
  readonly stageKey: string;
  status: TrialStatus;
  readonly initialReadingMl: number;
  finalReadingMl: number | null;
  deliveredMl: number | null;
  /** Reported quantity for concordance (molarity for Expt 2). */
  reportedMolarityM: number | null;
  endpointJudgement: "correct" | "undertitrated" | "overshot" | null;
  rejectionReason: string | null;
  errorCodes: string[];
}

export type ErrorCode =
  | "reading_error"
  | "over_titration"
  | "wrong_reagent"
  | "invalid_sequence"
  | "excessive_delivery"
  | "failed_concordance"
  | "unsafe_action";

export interface ErrorEvent {
  readonly code: ErrorCode;
  readonly trialNumber: number | null;
  readonly stageKey: string | null;
  readonly detail: string;
  readonly severe: boolean;
}

export function startTrial(
  trials: TrialRecord[],
  trialNumber: number,
  stageKey: string,
  initialReadingMl: number,
  maxTrials: number,
): TrialRecord {
  if (trials.some((t) => t.trialNumber === trialNumber && t.stageKey === stageKey)) {
    throw new Error(`trial ${trialNumber} for stage ${stageKey} already exists`);
  }
  if (trials.length >= maxTrials) {
    throw new Error(`trial limit of ${maxTrials} reached`);
  }
  if (trials.some((t) => t.status === "open")) {
    throw new Error("another trial is still open");
  }
  return {
    trialNumber,
    stageKey,
    status: "open",
    initialReadingMl: roundTo(initialReadingMl, 2),
    finalReadingMl: null,
    deliveredMl: null,
    reportedMolarityM: null,
    endpointJudgement: null,
    rejectionReason: null,
    errorCodes: [],
  };
}

export interface ConcordanceResult {
  readonly concordant: boolean;
  /** Spread that was evaluated (M for molarity mode, mL for volume mode). */
  readonly spread: number;
  readonly detail: string;
}

/**
 * Molarity-mode concordance (Experiment 2 rule): max-min across the given
 * molarities must be <= maxSpreadM.
 */
export function evaluateMolarityConcordance(molaritiesM: number[], maxSpreadM: number): ConcordanceResult {
  const valid = molaritiesM.filter((m) => Number.isFinite(m));
  if (valid.length < 2) {
    return { concordant: false, spread: Number.NaN, detail: "need at least two trials" };
  }
  const spread = Math.max(...valid) - Math.min(...valid);
  return {
    concordant: spread <= maxSpreadM + 1e-12,
    spread: roundTo(spread, 6),
    detail: `spread ${roundTo(spread, 6)} M vs allowed ${maxSpreadM} M`,
  };
}

/** Volume-mode concordance for configurations that define it (e.g. ±0.1 mL). */
export function evaluateTitreConcordance(
  titresMl: number[],
  toleranceMl: number,
  minConcordantCount: number,
): ConcordanceResult {
  const valid = titresMl.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (valid.length < minConcordantCount) {
    return { concordant: false, spread: Number.NaN, detail: "not enough valid titres" };
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + minConcordantCount - 1 < valid.length; i += 1) {
    const window = valid.slice(i, i + minConcordantCount);
    const spread = window[window.length - 1] - window[0];
    if (spread < best) best = spread;
  }
  return {
    concordant: best <= toleranceMl + 1e-9,
    spread: roundTo(best, 4),
    detail: `best window spread ${roundTo(best, 4)} mL vs allowed ${toleranceMl} mL`,
  };
}

export function evaluateConcordanceForRules(
  rules: TrialRules,
  reportedMolaritiesM: number[],
  titresMl: number[],
): ConcordanceResult {
  if (rules.concordance.mode === "molarity") {
    return evaluateMolarityConcordance(reportedMolaritiesM, rules.concordance.maxSpreadM);
  }
  return evaluateTitreConcordance(
    titresMl,
    rules.concordance.toleranceMl,
    rules.concordance.minConcordantCount,
  );
}

/** Average of the two closest molarities (manual Part II reporting rule). */
export function averageTwoClosest(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (valid.length === 0) throw new RangeError("no values to average");
  if (valid.length === 1) return valid[0];
  let bestI = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < valid.length; i += 1) {
    const gap = valid[i + 1] - valid[i];
    if (gap < bestGap) {
      bestGap = gap;
      bestI = i;
    }
  }
  return roundTo((valid[bestI] + valid[bestI + 1]) / 2, 6);
}
