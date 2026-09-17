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

/** How the analyte is portioned: weighed solid, or an accurately pipetted volume. */
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

export const titrationExperimentConfigSchema = z.object({
  experimentNumber: z.number().int().positive(),
  nominalTitrantMolarityM: z.number().positive(),
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
