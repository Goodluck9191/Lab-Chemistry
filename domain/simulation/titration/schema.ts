/**
 * Runtime schema for the persisted titration session.
 *
 * `attempt_state.snapshot` is jsonb: anything could be in there on read. The
 * generic `simulationStateSchema` accepts an optional namespaced `titration`
 * document validated by THIS schema, so a corrupt or stale titration session
 * fails loudly on resume instead of half-loading an experiment.
 */
import { z } from "zod";

const flaskColourSchema = z.enum(["colourless", "faint_pink", "pink", "deep_pink"]);

const trialRecordSchema = z.object({
  trialNumber: z.number().int().min(1).max(20),
  stageKey: z.string().min(1).max(64),
  status: z.enum(["open", "recorded", "rejected", "discarded_overshoot"]),
  initialReadingMl: z.number().finite().min(0).max(200),
  finalReadingMl: z.number().finite().min(0).max(200).nullable(),
  deliveredMl: z.number().finite().min(0).max(200).nullable(),
  reportedMolarityM: z.number().finite().positive().nullable(),
  endpointJudgement: z.enum(["correct", "undertitrated", "overshot"]).nullable(),
  observedColour: flaskColourSchema.nullable().default(null),
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

/**
 * Derived concordance summary. Only student-visible quantities appear here: the
 * spread of the values the student themselves recorded plus the rule's allowed
 * tolerance, which the practical manual states openly.
 */
const concordanceSchema = z.object({
  mode: z.enum(["molarity", "titre_volume"]),
  requiredTrials: z.number().int().min(1).max(20),
  maxTrials: z.number().int().min(1).max(20),
  recordedTrials: z.number().int().min(0).max(20),
  discardedTrials: z.array(z.number().int().min(1).max(20)).max(20),
  reportedMolaritiesM: z.array(z.number().finite().positive()).max(20),
  spread: z.number().finite().nonnegative().nullable(),
  allowedSpread: z.number().finite().positive(),
  spreadUnit: z.enum(["mol/L", "mL"]),
  concordant: z.boolean(),
  averageMolarityM: z.number().finite().positive().nullable(),
  trialsStillNeeded: z.number().int().min(0).max(20),
  detail: z.string().max(300),
});

const observationSchema = z.object({
  stageKey: z.string().min(1).max(64),
  fieldKey: z.string().regex(/^[a-z0-9_]{3,64}$/),
  textValue: z.string().min(1).max(2000),
});

const stagePreparationSchema = z.object({
  buretteCleaned: z.boolean(),
  conditioningRinses: z.number().int().min(0).max(10),
  airBubbleCleared: z.boolean(),
  beakerMassG: z.number().finite().positive().nullable(),
  beakerPlusKhpMassG: z.number().finite().positive().nullable(),
  khpDissolved: z.boolean(),
  khpTransferred: z.boolean(),
  beakerRinses: z.number().int().min(0).max(10),
  // Defaulted: a snapshot written before the portion step still resumes.
  beakerObtained: z.boolean().default(false),
  flaskPlaced: z.boolean(),
  lastTrialDiscarded: z.boolean(),
  wasteDiscards: z.number().int().min(0),
});

/**
 * Part I working titrant, at the attempt level. EVIDENCE ONLY apart from the two
 * booleans: the measured stock volume never determines a concentration, because
 * the procedure does not state one for the prepared solution.
 */
const workingSolutionSchema = z.object({
  stockVolumeMl: z.number().finite().positive().max(2000).nullable(),
  diluted: z.boolean(),
  mixed: z.boolean(),
});

const stageSessionSchema = z.object({
  phase: z.enum(["setup", "analyte_ready", "indicator_added", "titrating", "reported"]),
  apparatusReady: z.boolean(),
  indicatorDrops: z.number().int().min(1).max(20).nullable(),
  analyteMassG: z.number().finite().positive().nullable(),
  analyteVolumeMl: z.number().finite().positive().nullable(),
  buretteInitialMl: z.number().finite().min(0).nullable(),
  // Defaults let a snapshot written by an earlier phase resume unchanged: the
  // fields added in Phase 4 are additive, so they are filled rather than
  // failing the whole document.
  deliveredSoFarMl: z.number().finite().min(0).default(0),
  flaskColour: flaskColourSchema.nullable().default(null),
  /** Derived on every projection; ignored (and stripped) on resume. */
  concordance: concordanceSchema.optional(),
  /**
   * Procedure preparation. Optional so a snapshot written before it existed
   * still resumes — the resume path normalises a missing value to the empty
   * preparation. Live sessions always carry it.
   */
  preparation: stagePreparationSchema.optional(),
  trials: z.array(trialRecordSchema).max(20).default([]),
  reportedMolaritiesM: z.array(z.number().finite().positive()).max(20).default([]),
  openTrial: trialRecordSchema.nullable().default(null),
});

/** What may be persisted in `attempt_state.snapshot.titration`. */
export const titrationSessionStateSchema = z.object({
  schemaVersion: z.literal(1),
  experimentNumber: z.number().int().positive(),
  stages: z.record(z.string(), stageSessionSchema),
  /**
   * Part I. Optional so a snapshot written before the dilution steps existed
   * still resumes — the resume path normalises a missing value to the empty
   * working solution, exactly as it does for the stage preparation. Live
   * sessions always carry it.
   */
  solution: workingSolutionSchema.optional(),
  errorEvents: z.array(errorEventSchema).max(500),
  completedTrials: z.number().int().min(0),
  observations: z.array(observationSchema).max(40).default([]),
});

/**
 * What may leave the server. Strictly stricter than the stored document: the
 * derived concordance summary must be present, so a projection that forgot to
 * compute it fails validation instead of reaching a student's screen.
 */
export const titrationPublicStateSchema = titrationSessionStateSchema.extend({
  stages: z.record(z.string(), stageSessionSchema.extend({ concordance: concordanceSchema })),
  solution: workingSolutionSchema,
});

export type TitrationPublicStateJson = z.infer<typeof titrationPublicStateSchema>;

/**
 * The STORED shape: `preparation` may be absent on documents written before it
 * existed. Reads normalise it (see `resumeSessionFromSnapshot`); the live
 * engine shape `TitrationSessionState` always carries it.
 */
export type StoredTitrationSessionState = z.infer<typeof titrationSessionStateSchema>;
export type StoredStageSession = StoredTitrationSessionState["stages"][string];
