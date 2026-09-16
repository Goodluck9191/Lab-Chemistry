/**
 * Runtime schema for the persisted titration session.
 *
 * `attempt_state.snapshot` is jsonb: anything could be in there on read. The
 * generic `simulationStateSchema` accepts an optional namespaced `titration`
 * document validated by THIS schema, so a corrupt or stale titration session
 * fails loudly on resume instead of half-loading an experiment.
 */
import { z } from "zod";

const trialRecordSchema = z.object({
  trialNumber: z.number().int().min(1).max(20),
  stageKey: z.string().min(1).max(64),
  status: z.enum(["open", "recorded", "rejected", "discarded_overshoot"]),
  initialReadingMl: z.number().finite().min(0).max(200),
  finalReadingMl: z.number().finite().min(0).max(200).nullable(),
  deliveredMl: z.number().finite().min(0).max(200).nullable(),
  reportedMolarityM: z.number().finite().positive().nullable(),
  endpointJudgement: z.enum(["correct", "undertitrated", "overshot"]).nullable(),
  rejectionReason: z.string().max(500).nullable(),
  errorCodes: z.array(z.string().max(64)).max(500),
});

const errorEventSchema = z.object({
  code: z.enum([
    "reading_error",
    "over_titration",
    "wrong_reagent",
    "invalid_sequence",
    "excessive_delivery",
    "failed_concordance",
    "unsafe_action",
  ]),
  trialNumber: z.number().int().min(1).max(20).nullable(),
  stageKey: z.string().min(1).max(64).nullable(),
  detail: z.string().max(1000),
  severe: z.boolean(),
});

const stageSessionSchema = z.object({
  phase: z.enum(["setup", "analyte_ready", "indicator_added", "titrating", "reported"]),
  apparatusReady: z.boolean(),
  indicatorDrops: z.number().int().min(1).max(20).nullable(),
  analyteMassG: z.number().finite().positive().nullable(),
  analyteVolumeMl: z.number().finite().positive().nullable(),
  buretteInitialMl: z.number().finite().min(0).nullable(),
  deliveredSoFarMl: z.number().finite().min(0),
  trials: z.array(trialRecordSchema).max(20),
  reportedMolaritiesM: z.array(z.number().finite().positive()).max(20),
  openTrial: trialRecordSchema.nullable(),
});

export const titrationPublicStateSchema = z.object({
  schemaVersion: z.literal(1),
  experimentNumber: z.number().int().positive(),
  stages: z.record(z.string(), stageSessionSchema),
  errorEvents: z.array(errorEventSchema).max(500),
  completedTrials: z.number().int().min(0),
});

export type TitrationPublicStateJson = z.infer<typeof titrationPublicStateSchema>;
