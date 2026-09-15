/**
 * Generic titration engine: session state, validated actions, public
 * projection and the assessment foundation.
 *
 * STUDENT vs HIDDEN: the session keeps `hidden` (server side only) apart from
 * `public` (safe to serialise to the browser). `toPublicJSON()` returns only
 * the public half; grading takes both. No action can set a score, a hidden
 * concentration or an endpoint — those are derived, never assigned.
 *
 * ACTIONS (domain names; Phase 3 will map them to the persistence protocol):
 * setupApparatus -> weighAnalyte/pipetteAnalyte -> addIndicator ->
 * startTrial -> addTitrant -> readBurette -> observeEndpoint ->
 * completeTrial (/ discardTrial on overshoot) -> reportMolarity x N ->
 * assessment via gradeSession().
 */
import {
  analyteConcentrationFromTitration,
  molesFromMassAndMolarMass,
} from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";
import { roundTo } from "@/domain/chemistry/units";
import { createSeededRandom, deriveSeed } from "@/domain/simulation/random";
import { deliveredVolumeMl, titreFitsBurette } from "./burette";
import type { TitrationExperimentConfig, TitrationStageConfig } from "./config";
import { judgeEndpointStop, observeFlaskColour, type FlaskColour } from "./endpoint";
import { deriveHiddenState, type AttemptHiddenState } from "./hidden";
import { classifyReadingError } from "./reading";
import {
  averageTwoClosest,
  evaluateConcordanceForRules,
  evaluateMolarityConcordance,
  startTrial,
  type ErrorEvent,
  type TrialRecord,
} from "./trials";

export type SessionPhase =
  | "setup"
  | "analyte_ready"
  | "indicator_added"
  | "titrating"
  | "reported";

export interface StageSession {
  phase: SessionPhase;
  apparatusReady: boolean;
  indicatorDrops: number | null;
  analyteMassG: number | null;
  analyteVolumeMl: number | null;
  buretteInitialMl: number | null;
  deliveredSoFarMl: number;
  trials: TrialRecord[];
  reportedMolaritiesM: number[];
  openTrial: TrialRecord | null;
}

export interface TitrationPublicState {
  readonly schemaVersion: 1;
  readonly experimentNumber: number;
  readonly stages: Record<string, StageSession>;
  readonly errorEvents: ErrorEvent[];
  completedTrials: number;
}

export interface TitrationSession {
  readonly config: TitrationExperimentConfig;
  readonly hidden: AttemptHiddenState;
  readonly public: TitrationPublicState;
}

export type ActionResult = { ok: true } | { ok: false; error: string; code: string };

function fail(error: string, code: string): ActionResult {
  return { ok: false, error, code };
}

function stageConfig(config: TitrationExperimentConfig, stageKey: string): TitrationStageConfig {
  const stage = config.stages.find((s) => s.key === stageKey);
  if (!stage) throw new Error(`unknown stage ${stageKey}`);
  return stage;
}

function mutableStage(session: TitrationSession, stageKey: string): StageSession {
  const stage = session.public.stages[stageKey];
  if (!stage) throw new Error(`unknown stage ${stageKey}`);
  return stage;
}

function recordError(
  session: TitrationSession,
  event: ErrorEvent,
): void {
  session.public.errorEvents.push(event);
}

/** Fresh session: hidden reality derived from the seed; public starts empty. */
export function createTitrationSession(
  config: TitrationExperimentConfig,
  seed: string,
): TitrationSession {
  const hidden = deriveHiddenState(config, seed, config.endpointBiasMl);
  const stages: Record<string, StageSession> = {};
  for (const stage of config.stages) {
    stages[stage.key] = {
      phase: "setup",
      apparatusReady: false,
      indicatorDrops: null,
      analyteMassG: null,
      analyteVolumeMl: null,
      buretteInitialMl: null,
      deliveredSoFarMl: 0,
      trials: [],
      reportedMolaritiesM: [],
      openTrial: null,
    };
  }
  return {
    config,
    hidden,
    public: {
      schemaVersion: 1,
      experimentNumber: config.experimentNumber,
      stages,
      errorEvents: [],
      completedTrials: 0,
    },
  };
}

/** Rinse + fill + clamp + expel bubbles: one setup step per stage. */
export function setupApparatus(
  session: TitrationSession,
  stageKey: string,
  titrantKey: string,
  initialReadingMl: number,
): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (titrantKey !== cfg.titrantKey) {
    recordError(session, {
      code: "wrong_reagent",
      trialNumber: null,
      stageKey,
      detail: `expected titrant ${cfg.titrantKey}, got ${titrantKey}`,
      severe: false,
    });
    return fail(`wrong titrant: expected ${cfg.titrantKey}`, "wrong_reagent");
  }
  if (!(initialReadingMl >= 0 && initialReadingMl <= cfg.burette.capacityMl)) {
    return fail("initial reading outside burette capacity", "invalid_sequence");
  }
  stage.apparatusReady = true;
  stage.buretteInitialMl = roundTo(initialReadingMl, 2);
  stage.deliveredSoFarMl = 0;
  stage.phase = "setup";
  return { ok: true };
}

export function weighAnalyte(
  session: TitrationSession,
  stageKey: string,
  observedMassG: number,
): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (cfg.analytePortion.kind !== "weighed_mass") {
    return fail("this stage does not weigh its analyte", "invalid_sequence");
  }
  if (!stage.apparatusReady) {
    recordError(session, {
      code: "invalid_sequence",
      trialNumber: null,
      stageKey,
      detail: "weighed before apparatus setup",
      severe: false,
    });
    return fail("set up the burette before weighing", "invalid_sequence");
  }
  if (!(observedMassG > 0) || !Number.isFinite(observedMassG)) {
    return fail("weighed mass must be positive", "invalid_sequence");
  }
  stage.analyteMassG = roundTo(observedMassG, 2);
  stage.phase = "analyte_ready";
  const quality = classifyReadingError("balance", Math.abs(observedMassG - cfg.analytePortion.nominalMassG));
  if (quality === "gross_error") {
    recordError(session, {
      code: "reading_error",
      trialNumber: null,
      stageKey,
      detail: `implausible weighed mass ${observedMassG} g`,
      severe: false,
    });
  }
  return { ok: true };
}

export function pipetteAnalyte(
  session: TitrationSession,
  stageKey: string,
  observedVolumeMl: number,
): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (cfg.analytePortion.kind !== "pipetted_volume") {
    return fail("this stage does not pipette its analyte", "invalid_sequence");
  }
  if (!stage.apparatusReady) {
    return fail("set up the burette before pipetting", "invalid_sequence");
  }
  if (!(observedVolumeMl > 0) || !Number.isFinite(observedVolumeMl)) {
    return fail("pipetted volume must be positive", "invalid_sequence");
  }
  stage.analyteVolumeMl = roundTo(observedVolumeMl, 2);
  stage.phase = "analyte_ready";
  return { ok: true };
}

export function addIndicator(
  session: TitrationSession,
  stageKey: string,
  drops: number,
): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (stage.phase !== "analyte_ready") {
    recordError(session, {
      code: "invalid_sequence",
      trialNumber: null,
      stageKey,
      detail: "indicator added before the analyte was ready",
      severe: false,
    });
    return fail("prepare the analyte before adding indicator", "invalid_sequence");
  }
  const [min, max] = cfg.indicator.drops;
  if (!Number.isInteger(drops) || drops < 1 || drops > 20) {
    return fail("indicator drops must be an integer 1..20", "invalid_sequence");
  }
  stage.indicatorDrops = drops;
  stage.phase = "indicator_added";
  if (drops < min || drops > max) {
    recordError(session, {
      code: "reading_error",
      trialNumber: null,
      stageKey,
      detail: `indicator ${drops} drops outside manual range ${min}-${max}`,
      severe: false,
    });
  }
  return { ok: true };
}

export function startTrialAction(
  session: TitrationSession,
  stageKey: string,
  trialNumber: number,
  initialReadingMl: number,
): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (stage.phase !== "indicator_added" && stage.phase !== "titrating") {
    return fail("add indicator before starting a trial", "invalid_sequence");
  }
  if (!(initialReadingMl >= 0 && initialReadingMl <= cfg.burette.capacityMl)) {
    return fail("initial reading outside burette capacity", "invalid_sequence");
  }
  try {
    const trial = startTrial(
      stage.trials,
      trialNumber,
      stageKey,
      initialReadingMl,
      session.config.trialRules.maxTrials,
    );
    stage.openTrial = trial;
    stage.phase = "titrating";
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "cannot start trial", "invalid_sequence");
  }
}

/**
 * Deliver titrant into the open trial's flask. Returns the flask colour so
 * the student judges the endpoint from observation, not from a number.
 */
export function addTitrant(
  session: TitrationSession,
  stageKey: string,
  volumeMl: number,
): ActionResult & { colour?: FlaskColour } {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  const trial = stage.openTrial;
  if (!trial || trial.status !== "open") {
    return fail("no open trial to add titrant to", "invalid_sequence");
  }
  if (!(volumeMl > 0) || !Number.isFinite(volumeMl)) {
    return fail("titrant increment must be positive", "invalid_sequence");
  }
  const deliveredSoFar = trialDelivered(trial) + volumeMl;
  const truth = session.hidden.stages[stageKey];
  if (!titreFitsBurette(cfg.burette, trial.initialReadingMl, deliveredSoFar)) {
    recordError(session, {
      code: "excessive_delivery",
      trialNumber: trial.trialNumber,
      stageKey,
      detail: `delivery ${deliveredSoFar.toFixed(2)} mL needs a refill`,
      severe: false,
    });
    return fail("burette capacity exceeded: refill and repeat the trial", "excessive_delivery");
  }
  trial.errorCodes.push(`delivered:${roundTo(volumeMl, 2)}`);
  const total = trialDelivered(trial);
  const colour = observeFlaskColour(cfg.indicator, total, {
    equivalenceMl: truth.equivalenceMl,
    observableMl: truth.observableMl,
  }).colour;
  return { ok: true, colour };
}

function trialDelivered(trial: TrialRecord): number {
  let total = 0;
  for (const code of trial.errorCodes) {
    if (code.startsWith("delivered:")) total += Number(code.slice("delivered:".length));
  }
  return roundTo(total, 2);
}

export function readBurette(
  session: TitrationSession,
  stageKey: string,
  observedFinalMl: number,
): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  const trial = stage.openTrial;
  if (!trial || trial.status !== "open") {
    return fail("no open trial to read", "invalid_sequence");
  }
  try {
    const delivered = deliveredVolumeMl(cfg.burette, trial.initialReadingMl, observedFinalMl);
    const expected = trialDelivered(trial);
    if (Math.abs(delivered - expected) > 0.06) {
      recordError(session, {
        code: "reading_error",
        trialNumber: trial.trialNumber,
        stageKey,
        detail: `burette reading implies ${delivered.toFixed(2)} mL but ${expected.toFixed(2)} mL was delivered`,
        severe: false,
      });
    }
    trial.finalReadingMl = roundTo(observedFinalMl, 2);
    trial.deliveredMl = delivered;
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "invalid reading", "reading_error");
  }
}

export function observeEndpoint(
  session: TitrationSession,
  stageKey: string,
  claimedColour: FlaskColour,
): ActionResult & { actual?: FlaskColour } {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  const trial = stage.openTrial;
  if (!trial || trial.status !== "open") {
    return fail("no open trial to observe", "invalid_sequence");
  }
  const truth = session.hidden.stages[stageKey];
  const delivered = trial.deliveredMl ?? trialDelivered(trial);
  const actual = observeFlaskColour(cfg.indicator, delivered, {
    equivalenceMl: truth.equivalenceMl,
    observableMl: truth.observableMl,
  }).colour;
  if (claimedColour !== actual) {
    recordError(session, {
      code: "reading_error",
      trialNumber: trial.trialNumber,
      stageKey,
      detail: `claimed ${claimedColour} but flask shows ${actual}`,
      severe: false,
    });
  }
  return { ok: true, actual };
}

export function completeTrial(session: TitrationSession, stageKey: string): ActionResult {
  const stage = mutableStage(session, stageKey);
  const trial = stage.openTrial;
  if (!trial || trial.status !== "open") {
    return fail("no open trial to complete", "invalid_sequence");
  }
  if (trial.deliveredMl === null || trial.finalReadingMl === null) {
    return fail("read the burette before completing the trial", "invalid_sequence");
  }
  const truth = session.hidden.stages[stageKey];
  const judgement = judgeEndpointStop(trial.deliveredMl, {
    equivalenceMl: truth.equivalenceMl,
    observableMl: truth.observableMl,
  });
  trial.endpointJudgement = judgement;
  if (judgement === "overshot") {
    trial.status = "discarded_overshoot";
    trial.rejectionReason = "overshot endpoint: discard and repeat per manual";
    recordError(session, {
      code: "over_titration",
      trialNumber: trial.trialNumber,
      stageKey,
      detail: `delivered ${trial.deliveredMl.toFixed(2)} mL vs observable ${truth.observableMl.toFixed(2)} mL`,
      severe: false,
    });
    stage.trials.push(trial);
    stage.openTrial = null;
    return { ok: true };
  }
  trial.status = "recorded";
  stage.trials.push(trial);
  stage.openTrial = null;
  stage.phase = "titrating";
  session.public.completedTrials += 1;
  return { ok: true };
}

/**
 * Student reports the molarity they calculated for one recorded trial.
 * The engine checks it against the hidden truth using the stage
 * stoichiometry — the student can never set the expected answer.
 */
export function reportMolarity(
  session: TitrationSession,
  stageKey: string,
  trialNumber: number,
  studentMolarityM: number,
): ActionResult & { correct?: boolean; expected?: number } {
  const stage = mutableStage(session, stageKey);
  const trial = stage.trials.find((t) => t.trialNumber === trialNumber);
  if (!trial || trial.status !== "recorded") {
    return fail("report against a recorded trial only", "invalid_sequence");
  }
  if (!Number.isFinite(studentMolarityM) || studentMolarityM <= 0) {
    return fail("reported molarity must be positive", "invalid_sequence");
  }
  const expected = expectedMolarityForTrial(session, stageKey, trial);
  const tolerance = Math.max(0.005, expected * 0.02);
  const correct = Math.abs(studentMolarityM - expected) <= tolerance + 1e-12;
  trial.reportedMolarityM = roundTo(studentMolarityM, 6);
  stage.reportedMolaritiesM.push(roundTo(studentMolarityM, 6));
  if (!correct) {
    recordError(session, {
      code: "reading_error",
      trialNumber,
      stageKey,
      detail: `reported ${studentMolarityM} M vs expected ${expected.toFixed(6)} M`,
      severe: false,
    });
  }
  return { ok: true, correct, expected: roundTo(expected, 6) };
}

function expectedMolarityForTrial(
  session: TitrationSession,
  stageKey: string,
  trial: TrialRecord,
): number {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  const truth = session.hidden.stages[stageKey];
  const deliveredMl = trial.deliveredMl ?? 0;
  if (cfg.analytePortion.kind === "weighed_mass") {
    const massG = stage.analyteMassG ?? cfg.analytePortion.nominalMassG;
    const analyteMoles = molesFromMassAndMolarMass(massG, KHP_MOLAR_MASS_G_PER_MOL);
    // M_NaOH = n_KHP / V_NaOH (1:1 per manual general equation).
    return analyteMoles / (deliveredMl / 1000);
  }
  const analyteL = (stage.analyteVolumeMl ?? cfg.analytePortion.nominalVolumeMl) / 1000;
  return analyteConcentrationFromTitration({
    titrantMolarityMolPerL: truth.trueTitrantMolarityM,
    titrantVolumeValue: deliveredMl,
    titrantVolumeUnit: "mL",
    analyteVolumeValue: analyteL * 1000,
    analyteVolumeUnit: "mL",
    stoichiometry: {
      analyteCoefficient: cfg.stoichiometry.analyteCoefficient,
      titrantCoefficient: cfg.stoichiometry.titrantCoefficient,
    },
  });
}

/** Serialisable public projection. Contains NOTHING hidden by construction. */
export function toPublicJSON(session: TitrationSession): TitrationPublicState {
  return JSON.parse(JSON.stringify(session.public)) as TitrationPublicState;
}

export interface GradeBreakdown {
  readonly total: number;
  readonly lines: Array<{ key: string; awarded: number; max: number; note: string }>;
  readonly concordant: boolean;
  readonly averageMolarityM: number | null;
}

/**
 * Assessment foundation: score from student actions + hidden truth.
 * Weights come from configuration; the student never supplies a score.
 */
export function gradeSession(session: TitrationSession, stageKey: string): GradeBreakdown {
  const stage = mutableStage(session, stageKey);
  const weights = session.config.assessmentWeights;
  const get = (key: string): number => weights[key] ?? 0;

  const recorded = stage.trials.filter((t) => t.status === "recorded");
  const overshoots = session.public.errorEvents.filter((e) => e.code === "over_titration").length;
  const readingErrors = session.public.errorEvents.filter((e) => e.code === "reading_error").length;

  const techniqueMax = get("technique");
  const technique = Math.max(0, techniqueMax - overshoots * 5 - readingErrors * 1);

  const endpointMax = get("endpoint");
  const correctStops = recorded.filter((t) => t.endpointJudgement === "correct").length;
  const endpoint =
    recorded.length === 0 ? 0 : (endpointMax * correctStops) / recorded.length;

  let concordant = false;
  let average: number | null = null;
  if (stage.reportedMolaritiesM.length >= 2) {
    const rules = session.config.trialRules;
    if (rules.concordance.mode === "molarity") {
      const result = evaluateMolarityConcordance(
        stage.reportedMolaritiesM,
        rules.concordance.maxSpreadM,
      );
      concordant = result.concordant;
    } else {
      const titres = recorded.map((t) => t.deliveredMl ?? Number.NaN);
      const result = evaluateConcordanceForRules(rules, [], titres);
      concordant = result.concordant;
    }
    average = averageTwoClosest(stage.reportedMolaritiesM);
  }
  const concordanceMax = get("concordance");
  const concordance = concordant ? concordanceMax : 0;

  const calcMax = get("calculations");
  let calcScore = 0;
  if (stage.reportedMolaritiesM.length > 0) {
    const within = stage.reportedMolaritiesM.filter((m, i) => {
      const trial = recorded[i];
      if (!trial) return false;
      const exp = expectedMolarityForTrial(session, stageKey, trial);
      return Math.abs(m - exp) <= Math.max(0.005, exp * 0.02) + 1e-12;
    }).length;
    calcScore = (calcMax * within) / stage.reportedMolaritiesM.length;
  }

  const total = roundTo(technique + endpoint + concordance + calcScore, 2);
  return {
    total,
    lines: [
      { key: "technique", awarded: roundTo(technique, 2), max: techniqueMax, note: `${overshoots} overshoot(s), ${readingErrors} reading flag(s)` },
      { key: "endpoint", awarded: roundTo(endpoint, 2), max: endpointMax, note: `${correctStops}/${recorded.length} correct stops` },
      { key: "concordance", awarded: roundTo(concordance, 2), max: concordanceMax, note: concordant ? "within manual 0.005 M rule" : "not concordant" },
      { key: "calculations", awarded: roundTo(calcScore, 2), max: calcMax, note: `${stage.reportedMolaritiesM.length} reported` },
    ],
    concordant,
    averageMolarityM: average,
  };
}

/** Deterministic instrument-noise draw for tests and later stages. */
export function drawReadingNoiseMl(seed: string, scope: string, stdDevMl: number): number {
  return createSeededRandom(deriveSeed(seed, scope)).noise(stdDevMl);
}
