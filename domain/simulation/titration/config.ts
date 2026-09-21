/**
 * Generic, configuration-driven titration model.
 *
 * ARCHITECTURE: the engine implements titration mechanics once; every
 * experiment (acid-base, redox, precipitation, complexometric) is a
 * configuration of this schema. Phase 2 fully exercises the acid-base
 * pathway via Experiment 2; the other families are structurally supported
 * (parsed + routed) without their specialised chemistry yet.
 */
import { z } from "zod";

export const TITRATION_FAMILIES = [
  "acid_base",
  "redox",
  "precipitation",
  "complexometric",
] as const;
export type TitrationFamily = (typeof TITRATION_FAMILIES)[number];

export const ENDPOINT_STYLES = [
  "indicator_colour",
  "self_indicating",
  "starch",
  "double_indicator",
  "potentiometric",
] as const;
export type EndpointStyle = (typeof ENDPOINT_STYLES)[number];

export const stoichiometrySchema = z.object({
  analyteCoefficient: z.number().int().positive(),
  titrantCoefficient: z.number().int().positive(),
});
export type StoichiometryConfig = z.infer<typeof stoichiometrySchema>;

/**
 * Indicator model. `transitionPhRange` is optional because the manual does
 * NOT state one for phenolphthalein (only "colourless in acid, pink in
 * base"); configs must leave it null rather than invent a range.
 */
export const indicatorConfigSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  acidColour: z.string().min(1).max(64),
  baseColour: z.string().min(1).max(64),
  drops: z.tuple([z.number().int().min(1), z.number().int().max(20)]),
  endpointPersistenceSeconds: z.tuple([z.number().positive(), z.number().positive()]),
  transitionPhRange: z.tuple([z.number(), z.number()]).nullable(),
});
export type IndicatorConfig = z.infer<typeof indicatorConfigSchema>;

export const buretteConfigSchema = z.object({
  capacityMl: z.number().positive().max(200),
  graduationMl: z.number().positive(),
  /** Smallest reportable increment, e.g. 0.02 mL for the manual's estimation. */
  readingPrecisionMl: z.number().positive(),
  maxDeliveredMl: z.number().positive(),
});
export type BuretteConfig = z.infer<typeof buretteConfigSchema>;

export const trialRulesSchema = z.object({
  minTrials: z.number().int().min(1).max(20),
  maxTrials: z.number().int().min(1).max(20),
  /**
   * Hard cap on ATTEMPTS per stage, including ones discarded for overshoot.
   * Kept separate from `maxTrials` because the manual's "repeat three times,
   * a fourth if the values disagree" counts recorded trials only: a discarded
   * overshoot is repeated, not counted. Defaults to `maxTrials`.
   */
  maxTrialAttempts: z.number().int().min(1).max(20).optional(),
  /** Discard-and-repeat rule, e.g. overshoot. */
  discardOnOvershoot: z.boolean(),
  /** Concordance expressed on the REPORTED quantity (molarity for Expt 2). */
  concordance: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("molarity"),
      maxSpreadM: z.number().positive(),
      useClosestPairAverage: z.boolean(),
    }),
    z.object({
      mode: z.literal("titre_volume"),
      toleranceMl: z.number().positive(),
      minConcordantCount: z.number().int().min(2).max(10),
    }),
  ]),
});
export type TrialRules = z.infer<typeof trialRulesSchema>;

/**
 * How the analyte is portioned: weighed solid, or a measured volume.
 *
 * The `pipetted_volume` kind keeps its name for protocol and stored-data
 * compatibility, but it means "the analyte is portioned as an accurately
 * measured volume" — WHICH piece of ware delivers it is stated by `vessel`,
 * because the two are not interchangeable in a procedure (the manual for
 * Experiment 2 specifies a measuring cylinder, not a pipette).
 *
 * `vessel` values are APPARATUS KEYS from the public catalog, so the laboratory
 * can show the catalog's own name and say honestly whether the experiment lists
 * the ware it uses.
 */
export const analytePortionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("weighed_mass"),
    nominalMassG: z.number().positive(),
    balancePrecisionG: z.number().positive(),
  }),
  z.object({
    kind: z.literal("pipetted_volume"),
    nominalVolumeMl: z.number().positive(),
    volumePrecisionMl: z.number().positive(),
    vessel: z.enum(["graduated_cylinder", "pipette"]),
  }),
]);
export type AnalytePortionConfig = z.infer<typeof analytePortionSchema>;

/** One titrand/titrant stage, e.g. "KHP vs NaOH" then "HCl vs NaOH". */
export const titrationStageConfigSchema = z.object({
  key: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  family: z.enum(TITRATION_FAMILIES),
  endpointStyle: z.enum(ENDPOINT_STYLES),
  reactionEquation: z.string().min(1).max(300),
  stoichiometry: stoichiometrySchema,
  titrantKey: z.string().min(1).max(64),
  analyteKey: z.string().min(1).max(64),
  analytePortion: analytePortionSchema,
  indicator: indicatorConfigSchema,
  burette: buretteConfigSchema,
});
export type TitrationStageConfig = z.infer<typeof titrationStageConfigSchema>;

/**
 * Part I of a procedure that dilutes its own working titrant from a stock
 * solution, or null when the experiment is given a ready-made titrant and has
 * no dilution step to perform.
 *
 * Both strengths are stated openly by the procedure ("2 M NaOH stock",
 * "approximately 0.2 M NaOH"); nothing here is an answer key. The volume the
 * student measures is EVIDENCE of having performed the step, never chemistry:
 * the working strength stays `nominalTitrantMolarityM` plus hidden truth.
 */
export const solutionDilutionSchema = z.object({
  stockKey: z.string().min(1).max(64),
  stockMolarityM: z.number().positive(),
  nominalWorkingMolarityM: z.number().positive(),
});
export type SolutionDilutionConfig = z.infer<typeof solutionDilutionSchema>;

export const titrationExperimentConfigSchema = z.object({
  experimentNumber: z.number().int().positive(),
  nominalTitrantMolarityM: z.number().positive(),
  /** Part I working-titrant dilution, or null when the titrant is ready-made. */
  solutionDilution: solutionDilutionSchema.nullable(),
  /** Hidden-reality ranges: simulation parameters, NOT manual values. */
  hiddenRanges: z.object({
    titrantMolarityM: z.tuple([z.number().positive(), z.number().positive()]),
    unknownAnalyteMolarityM: z.tuple([z.number().positive(), z.number().positive()]).nullable(),
  }),
  readingNoiseMl: z.number().min(0).max(0.5),
  endpointBiasMl: z.number().min(0).max(1),
  stages: z.array(titrationStageConfigSchema).min(1).max(4),
  trialRules: trialRulesSchema,
  assessmentWeights: z.record(z.string(), z.number().min(0)),
});
export type TitrationExperimentConfig = z.infer<typeof titrationExperimentConfigSchema>;

/**
 * Attempts a stage may run, discarded ones included. Configurations may leave it
 * out; the manual's rule ("repeat three times, a fourth if needed") then caps it
 * at `maxTrials`, which is exactly the historical behaviour.
 */
export function maxTrialAttemptsFor(rules: TrialRules): number {
  return rules.maxTrialAttempts ?? rules.maxTrials;
}

export function parseTitrationConfig(input: unknown): TitrationExperimentConfig {
  const parsed = titrationExperimentConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid titration configuration: ${parsed.error.message}`);
  }
  const config = parsed.data;
  const minTrials = config.trialRules.minTrials;
  const maxTrials = config.trialRules.maxTrials;
  if (minTrials > maxTrials) {
    throw new Error("trialRules.minTrials must be <= trialRules.maxTrials");
  }
  const maxAttempts = maxTrialAttemptsFor(config.trialRules);
  if (maxAttempts < maxTrials) {
    throw new Error("trialRules.maxTrialAttempts must be >= trialRules.maxTrials");
  }
  // `experiment_trials.trial_number` is unique per attempt and constrained to
  // 1..20, so the stages share one numbering space (see the persistence
  // projection). Each stage owns an equal block of it, and a stage may not be
  // configured to run more attempts than its block can number.
  const stride = Math.floor(20 / config.stages.length);
  if (maxAttempts > stride) {
    throw new Error(
      `trialRules.maxTrialAttempts (${maxAttempts}) exceeds the ${stride} trial numbers each stage has in experiment_trials (1..20)`,
    );
  }
  const weights = Object.values(config.assessmentWeights);
  if (weights.length > 0) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1e-9) {
      throw new Error(`assessmentWeights must total 100, got ${total}`);
    }
  }
  const [lo, hi] = config.hiddenRanges.titrantMolarityM;
  if (lo >= hi) {
    throw new Error("hiddenRanges.titrantMolarityM must satisfy min < max");
  }
  return config;
}
