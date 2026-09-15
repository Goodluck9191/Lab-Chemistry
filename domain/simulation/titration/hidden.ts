/**
 * Hidden per-attempt parameters derived deterministically from the seed.
 *
 * WHAT IS HIDDEN: the seed itself, true titrant/analyte concentrations, the
 * exact equivalence/observable endpoint volumes, noise draws. Students only
 * ever observe burette readings, colours and their own reported molarities.
 *
 * RANGES ARE SIMULATION PARAMETERS, not manual values: the manual states
 * nominal targets (~0.2 M NaOH from 2 M stock; unknown HCl) but no
 * per-student variation. Ranges below keep every attempt's hidden reality
 * within one burette filling for the manual's 0.6 g KHP / 25 mL HCl portions.
 */
import { equivalenceTitrantVolumeMl } from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";
import { createSeededRandom, deriveSeed } from "@/domain/simulation/random";
import type { TitrationExperimentConfig, TitrationStageConfig } from "./config";

export interface StageHiddenTruth {
  readonly stageKey: string;
  /** True titrant concentration for this attempt (mol/L). */
  readonly trueTitrantMolarityM: number;
  /** True analyte quantity: mass weighed (g) or concentration (mol/L). */
  readonly trueAnalyteMassG: number | null;
  readonly trueAnalyteMolarityM: number | null;
  readonly analyteMoles: number;
  readonly equivalenceMl: number;
  /** Indicator bias + noise already applied. */
  readonly observableMl: number;
}

export interface AttemptHiddenState {
  readonly seed: string;
  readonly stages: Record<string, StageHiddenTruth>;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hiddenForStage(
  stage: TitrationStageConfig,
  titrantMolarityM: number,
  unknownAnalyteMolarityM: number | null,
  analyteNoise: number,
): StageHiddenTruth {
  const stoich = {
    analyteCoefficient: stage.stoichiometry.analyteCoefficient,
    titrantCoefficient: stage.stoichiometry.titrantCoefficient,
  };

  let analyteMoles: number;
  let trueAnalyteMassG: number | null = null;
  let trueAnalyteMolarityM: number | null = null;

  if (stage.analytePortion.kind === "weighed_mass") {
    // KHP: nominal weighed mass with a small preparation spread.
    trueAnalyteMassG = round6(stage.analytePortion.nominalMassG * (1 + analyteNoise));
    analyteMoles = trueAnalyteMassG / KHP_MOLAR_MASS_G_PER_MOL;
  } else {
    if (unknownAnalyteMolarityM === null) {
      throw new Error(`stage ${stage.key} needs an unknown analyte molarity range`);
    }
    trueAnalyteMolarityM = round6(unknownAnalyteMolarityM * (1 + analyteNoise));
    const litres = stage.analytePortion.nominalVolumeMl / 1000;
    analyteMoles = trueAnalyteMolarityM * litres;
  }

  const equivalenceMl = equivalenceTitrantVolumeMl({
    analyteMoles,
    titrantMolarityMolPerL: titrantMolarityM,
    stoichiometry: stoich,
  });

  return {
    stageKey: stage.key,
    trueTitrantMolarityM: round6(titrantMolarityM),
    trueAnalyteMassG,
    trueAnalyteMolarityM,
    analyteMoles: round6(analyteMoles),
    equivalenceMl: round2(equivalenceMl),
    // Observable endpoint: filled in by deriveHiddenState once bias draws exist.
    observableMl: round2(equivalenceMl),
  };
}

/**
 * Derive the full hidden reality for an attempt. Deterministic in (seed,
 * config): identical inputs give byte-identical outputs.
 */
export function deriveHiddenState(
  config: TitrationExperimentConfig,
  seed: string,
  endpointBiasMl: number,
): AttemptHiddenState {
  if (seed.length === 0) throw new RangeError("seed must be non-empty");
  const rng = createSeededRandom(deriveSeed(seed, "hidden"));
  const [tLo, tHi] = config.hiddenRanges.titrantMolarityM;
  const titrantMolarityM = round6(rng.range(tLo, tHi));

  const unknownRange = config.hiddenRanges.unknownAnalyteMolarityM;
  const unknownMolarityM =
    unknownRange === null ? null : round6(rng.range(unknownRange[0], unknownRange[1]));

  const stages: Record<string, StageHiddenTruth> = {};
  for (const stage of config.stages) {
    const stageRng = createSeededRandom(deriveSeed(seed, `hidden:${stage.key}`));
    const analyteNoise = stageRng.range(-0.02, 0.02);
    const bias = stageRng.range(0, endpointBiasMl);
    const noise = stageRng.noise(0.02);
    const base = hiddenForStage(stage, titrantMolarityM, unknownMolarityM, analyteNoise);
    stages[stage.key] = {
      ...base,
      observableMl: round2(Math.max(0, base.equivalenceMl + bias + noise)),
    };
  }
  return { seed, stages };
}

/** Keys that must never appear in serialised public state (enforced by test). */
export const HIDDEN_KEY_DENYLIST = [
  "seed",
  "trueTitrantMolarityM",
  "trueAnalyteMolarityM",
  "trueAnalyteMassG",
  "analyteMoles",
  "equivalenceMl",
  "observableMl",
  "expectedEndpoint",
  "trueValues",
  "rubricWeights",
] as const;
