/**
 * Generic titration engine: session state, validated actions, public
 * projection and the assessment foundation.
 *
 * STUDENT vs HIDDEN: the session keeps `hidden` (server side only) apart from
 * `public` (safe to serialise to the browser). `toPublicJSON()` returns only
 * the public half; grading takes both. No action can set a score, a hidden
 * concentration or an endpoint — those are derived, never assigned.
 *
 * ACTIONS (domain names; the persistence protocol maps them in `dispatch`):
 * measureStockVolume/diluteWorkingSolution/mixWorkingSolution (Part I) ->
 * obtainTitrantPortion -> setupApparatus -> weighAnalyte/pipetteAnalyte ->
 * addIndicator ->
 * startTrial -> addTitrant -> readBurette -> observeEndpoint ->
 * completeTrial (/ discardTrial on overshoot) -> reportMolarity x N ->
 * assessment via gradeSession().
 */
import {
  analyteConcentrationFromTitration,
  massByDifference,
  molesFromMassAndMolarMass,
} from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";
import { roundTo } from "@/domain/chemistry/units";
import { createSeededRandom, deriveSeed } from "@/domain/simulation/random";
import { deliveredVolumeMl, titreFitsBurette } from "./burette";
import type { TitrationExperimentConfig, TitrationStageConfig } from "./config";
import { maxTrialAttemptsFor } from "./config";
import { judgeEndpointStop, observeFlaskColour, flaskColourFromConfigName, type FlaskColour } from "./endpoint";
import { deriveHiddenState, type AttemptHiddenState } from "./hidden";
import { classifyReadingError } from "./reading";
import {
  clampStopcockAngle,
  emptyStageWorld,
  stageWorldObservation,
  type StageWorld,
  type StageWorldObservation,
} from "./world";
import {
  averageTwoClosest,
  closestPairSpread,
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
  /** Current appearance of the flask contents, or null for an empty flask. */
  flaskColour: FlaskColour | null;
  trials: TrialRecord[];
  reportedMolaritiesM: number[];
  openTrial: TrialRecord | null;
  /** Procedure preparation (Part 2): cleaning, conditioning, KHP handling. */
  preparation: StagePreparation;
  /**
   * Physical placement facts: what is clamped, what is turned, what is
   * standing in a vessel. World state, not procedure state and not chemistry.
   */
  world: StageWorld;
}

/**
 * One student-submitted calculation value.
 *
 * The student's own number for a declared calculation prompt. Stored as the
 * student's work; correctness is recomputed server-side at grade time from
 * hidden state, so no expected value ever lives in the session document.
 */
export interface CalculationSubmission {
  readonly stageKey: string;
  readonly questionKey: string;
  readonly value: number;
  readonly unit: string;
  readonly trialNumber: number | null;
}

/**
 * Per-stage preparation state for the Experiment 2 procedure. Every step the
 * manual requires before and between titrations — burette cleaning and
 * conditioning, air-bubble removal, weighing by difference, dissolution,
 * transfer, beaker rinses, flask placement and waste disposal — tracked here
 * so the trial gate and the submit gate can enforce the order server-side.
 */
/**
 * Part I of the procedure: the working titrant prepared from a stock solution.
 *
 * ATTEMPT-level, not stage-level: the same prepared solution is used for every
 * stage of the experiment, so asking the student to dilute it again for Part III
 * would be wrong. Empty when the experiment is given a ready-made titrant.
 */
export interface WorkingSolutionPreparation {
  /**
   * Stock volume the student measured, in mL, or null before the step.
   *
   * EVIDENCE ONLY. The procedure does not state the final concentration of the
   * prepared solution, so this number is recorded and audited but deliberately
   * feeds no calculation: the working strength is the configuration's nominal
   * value plus the attempt's hidden truth.
   */
  stockVolumeMl: number | null;
  /** Distilled water added to complete the dilution. */
  diluted: boolean;
  /** Stopper as far as possible and swirl to mix. */
  mixed: boolean;
}

export function emptyWorkingSolution(): WorkingSolutionPreparation {
  return { stockVolumeMl: null, diluted: false, mixed: false };
}

export interface StagePreparation {
  /** Burette rinsed with tap water (manual: several ~10 mL portions). */
  buretteCleaned: boolean;
  /** NaOH conditioning rinses so far (manual: three ~5 mL portions). */
  conditioningRinses: number;
  /** Air expelled from the burette tip after filling. */
  airBubbleCleared: boolean;
  /** Empty-beaker weighing for the by-difference KHP sample. */
  beakerMassG: number | null;
  /** Beaker-plus-KHP weighing; the sample mass is the difference. */
  beakerPlusKhpMassG: number | null;
  /** KHP dissolved in ~30 mL distilled water. */
  khpDissolved: boolean;
  /** KHP solution transferred to the Erlenmeyer flask. */
  khpTransferred: boolean;
  /** Beaker rinses transferred after the solution (manual: twice). */
  beakerRinses: number;
  /**
   * A portion of the prepared titrant drawn into a clean, dry 250 mL beaker
   * and covered with a watch glass (manual: about 120 mL). The burette is
   * cleaned with tap water, then conditioned and filled from THIS beaker, so
   * taking the portion is a step in its own right.
   */
  beakerObtained: boolean;
  /**
   * The beaker is standing on the balance pan. A real precondition for reading
   * the instrument: a balance with an empty pan displays nothing to record.
   */
  beakerOnBalance: boolean;
  /**
   * The KHP standard has been tipped into the beaker. The WORLD fact that makes
   * the second weighing read heavier than the first; the sample mass itself is
   * still the student's own subtraction of the two readings they record.
   */
  khpAdded: boolean;
  /** Flask placed under the burette, ready to titrate. */
  flaskPlaced: boolean;
  /** The latest completed trial has been discarded into waste. */
  lastTrialDiscarded: boolean;
  /** Completed trials discarded to waste so far (waste level signal). */
  wasteDiscards: number;
}

/** Manual: "Rinse the burette with three portions of about 5 mL". */
export const REQUIRED_CONDITIONING_RINSES = 3;
/** Manual: "Rinse the beaker twice with about 5 mL distilled water". */
export const REQUIRED_BEAKER_RINSES = 2;

export function emptyPreparation(): StagePreparation {
  return {
    buretteCleaned: false,
    conditioningRinses: 0,
    airBubbleCleared: false,
    beakerMassG: null,
    beakerPlusKhpMassG: null,
    khpDissolved: false,
    khpTransferred: false,
    beakerRinses: 0,
    beakerObtained: false,
    beakerOnBalance: false,
    khpAdded: false,
    flaskPlaced: false,
    // True until a trial completes: waste tracking starts with the first trial
    // run under this state, so resumed attempts are never asked to discard a
    // flask that no longer exists.
    lastTrialDiscarded: true,
    wasteDiscards: 0,
  };
}

/**
 * Derived concordance summary. Computed by the domain from the trial rules and
 * the student's own recorded/reported values — never by the UI, so the browser
 * can display which trials agree without owning a second algorithm.
 */
export interface StageConcordance {
  readonly mode: "molarity" | "titre_volume";
  readonly requiredTrials: number;
  readonly maxTrials: number;
  readonly recordedTrials: number;
  /** Trial numbers discarded (overshoot or rejection) — shown, never re-run. */
  readonly discardedTrials: number[];
  readonly reportedMolaritiesM: number[];
  readonly spread: number | null;
  readonly allowedSpread: number;
  readonly spreadUnit: "mol/L" | "mL";
  readonly concordant: boolean;
  readonly averageMolarityM: number | null;
  readonly trialsStillNeeded: number;
  readonly detail: string;
}

/** A student-written observation. Text only; the engine stores no free numbers. */
export interface PublicObservation {
  readonly stageKey: string;
  readonly fieldKey: string;
  readonly textValue: string;
}

/** Maximum number of stored observations per attempt. */
export const MAX_OBSERVATIONS = 40;

/** Field keys are simple identifiers, so a client cannot inject arbitrary keys. */
export const OBSERVATION_FIELD_KEY_PATTERN = /^[a-z0-9_]{3,64}$/;

/** Internal + persisted session state (no derived projections). */
export interface TitrationSessionState {
  readonly schemaVersion: 1;
  readonly experimentNumber: number;
  readonly stages: Record<string, StageSession>;
  /** Part I: the working titrant, shared by every stage. */
  solution: WorkingSolutionPreparation;
  readonly errorEvents: ErrorEvent[];
  completedTrials: number;
  observations: PublicObservation[];
  /** The student's own submitted calculations, keyed by prompt. Student work. */
  calculations: CalculationSubmission[];
  /**
   * The procedure step the student is reading, so a resume opens where they left
   * off (§33). Navigation state only: it never gates an action, because the
   * procedure is a guide and the student is allowed to work ahead or step back.
   */
  procedureStep: number;
}

/**
 * Safe-to-render projection: session state plus the figures the server derives
 * on every read — the concordance summary and the instrument observations.
 */
export interface TitrationPublicState extends Omit<TitrationSessionState, "stages"> {
  readonly stages: Record<
    string,
    StageSession & { concordance: StageConcordance; observation: StageWorldObservation }
  >;
  readonly observations: PublicObservation[];
}

export interface TitrationSession {
  readonly config: TitrationExperimentConfig;
  readonly hidden: AttemptHiddenState;
  readonly public: TitrationSessionState;
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
      flaskColour: null,
      trials: [],
      reportedMolaritiesM: [],
      openTrial: null,
      preparation: emptyPreparation(),
      world: emptyStageWorld(),
    };
  }
  return {
    config,
    hidden,
    public: {
      schemaVersion: 1,
      experimentNumber: config.experimentNumber,
      stages,
      solution: emptyWorkingSolution(),
      errorEvents: [],
      completedTrials: 0,
      observations: [],
      calculations: [],
      procedureStep: 1,
    },
  };
}

/** Remember where in the procedure the student is reading. */
export function setProcedureStep(
  session: TitrationSession,
  step: number,
): ActionResult {
  if (!Number.isInteger(step) || step < 1 || step > 60) {
    return fail("procedure step out of range", "invalid_sequence");
  }
  session.public.procedureStep = step;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PHYSICAL WORLD ACTIONS
//
// What the student does with their hands before any chemistry happens. None of
// these decides a concentration: they move apparatus, turn a valve and record
// what a vessel holds. Chemistry stays where it was.
// ---------------------------------------------------------------------------

/**
 * Clamp the burette on the stand, or lift it off.
 *
 * A burette cannot be filled while it is lying in its cradle, so this is the
 * physical precondition the fill gate reads. Un-mounting is allowed: a student
 * who takes the instrument down has to put it back, which is its own lesson.
 */
export function mountBurette(
  session: TitrationSession,
  stageKey: string,
  mounted: boolean,
): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (typeof mounted !== "boolean") {
    return fail("mounting state must be a boolean", "invalid_sequence");
  }
  if (!mounted && stage.apparatusReady && stage.trials.length === 0 && stage.deliveredSoFarMl > 0) {
    // Taking a charged burette off the stand spills it; the world records the
    // loss rather than pretending nothing happened (§9).
    return fail(
      "a charged burette cannot be lifted off the clamp: drain it over the waste container first",
      "invalid_sequence",
    );
  }
  stage.world.buretteMounted = mounted;
  return { ok: true };
}

/** Turn the stopcock handle. Records the handle position; delivers nothing. */
export function setStopcockAngle(
  session: TitrationSession,
  stageKey: string,
  angleDeg: number,
): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (!Number.isFinite(angleDeg)) {
    return fail("stopcock angle must be a number", "invalid_sequence");
  }
  stage.world.stopcockAngleDeg = clampStopcockAngle(angleDeg);
  return { ok: true };
}

/**
 * Tip the standard into the beaker.
 *
 * The amount that ends up in the beaker is the sample the attempt actually
 * weighed out (a world fact); the student still determines the mass from their
 * own two weighings by difference. Adding it while the beaker sits on the pan
 * is refused, because the manual's method is weighing BY DIFFERENCE: the empty
 * beaker is weighed on its own, and the standard is added off the balance.
 */
export function addKhp(session: TitrationSession, stageKey: string): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (cfg.analytePortion.kind !== "weighed_mass") {
    return fail("this stage has no solid standard to add", "invalid_sequence");
  }
  const prep = stage.preparation;
  if (prep.khpAdded) {
    return fail("the standard is already in the beaker", "invalid_sequence");
  }
  if (prep.beakerOnBalance) {
    return fail(
      "take the beaker off the pan before adding the standard: the method is weighing by difference",
      "invalid_sequence",
    );
  }
  if (prep.beakerMassG === null) {
    return fail("weigh the empty beaker before adding the standard", "invalid_sequence");
  }
  prep.khpAdded = true;
  stage.flaskColour = null;
  return { ok: true };
}

/**
 * Set down, or lift off, the beaker on the balance pan.
 *
 * The pan is an instrument: what it displays is what stands on it. The UI sends
 * this when the student physically releases the beaker over the pan (or picks it
 * up again), and the reading gate refuses a weighing the pan cannot show.
 */
export function placeBeakerOnBalance(
  session: TitrationSession,
  stageKey: string,
  onPan: boolean,
): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (typeof onPan !== "boolean") {
    return fail("placement must be a boolean", "invalid_sequence");
  }
  stage.preparation.beakerOnBalance = onPan;
  return { ok: true };
}

/**
 * Pour titrant while no trial is running.
 *
 * Refusing this would teach nothing: a student who opens the tap before starting
 * a trial watches the burette empty. The volume is recorded as spilled — it
 * lowers the liquid level and leaves the trial's own readings inconsistent, which
 * is exactly the consequence a real bench produces (§9, §24).
 */
export function spillTitrant(
  session: TitrationSession,
  stageKey: string,
  volumeMl: number,
): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (!(volumeMl > 0) || !Number.isFinite(volumeMl)) {
    return fail("the spill volume must be positive", "invalid_sequence");
  }
  if (stage.openTrial) {
    return fail("a trial is running: deliver into the flask instead", "invalid_sequence");
  }
  const available = Math.max(0, cfg.burette.capacityMl - stage.world.spilledMl);
  const spilled = Math.min(volumeMl, available);
  if (spilled <= 0) return fail("the burette is empty", "excessive_delivery");
  stage.world.spilledMl = roundTo(stage.world.spilledMl + spilled, 2);
  recordError(session, {
    code: "invalid_sequence",
    trialNumber: null,
    stageKey,
    // SECURITY: no hidden value is quoted here; this detail is persisted into
    // the public snapshot and shipped to the browser.
    detail: "titrant run out with no trial open: the level has dropped",
    severe: false,
  });
  return { ok: true };
}

/**
 * Record what the measuring cylinder holds after the student has poured into it.
 *
 * A WORLD level, not a student measurement: the student reads this and records
 * their own volume separately. In Part I it feeds no concentration (the
 * procedure states no exact dilution volume), and in Part III the aliquot the
 * student records is what their calculation carries.
 */
export function recordCylinderVolume(
  session: TitrationSession,
  stageKey: string,
  volumeMl: number,
): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (!(volumeMl >= 0) || !Number.isFinite(volumeMl) || volumeMl > 2000) {
    return fail("cylinder volume must be a plausible number of millilitres", "invalid_sequence");
  }
  stage.world.cylinderVolumeMl = roundTo(volumeMl, 2);
  return { ok: true };
}

/**
 * Apply the bounded physical patch an envelope may carry alongside an action.
 *
 * Whitelisted and non-chemistry by construction: the valve angle inside its
 * quarter turn and a measuring-cylinder level inside a plausible range. Both are
 * facts about the student's own hands, and neither can set a concentration, an
 * endpoint or a grade.
 */
export function applyPhysicalPatch(
  session: TitrationSession,
  stageKey: string,
  patch: { stopcockAngleDeg?: number; cylinderVolumeMl?: number },
): void {
  const stage = mutableStage(session, stageKey);
  if (patch.stopcockAngleDeg !== undefined) {
    stage.world.stopcockAngleDeg = clampStopcockAngle(patch.stopcockAngleDeg);
  }
  if (patch.cylinderVolumeMl !== undefined) {
    stage.world.cylinderVolumeMl = roundTo(patch.cylinderVolumeMl, 2);
  }
}

/**
 * Record a student's own calculation value for a declared prompt.
 *
 * Nothing is checked here beyond shape: whether the value is right is a question
 * for server-side grading AFTER submission (§23). The student may correct their
 * own draft as often as they like before then.
 */
export function submitCalculation(
  session: TitrationSession,
  stageKey: string,
  questionKey: string,
  value: number,
  unit: string,
  trialNumber: number | null = null,
): ActionResult {
  mutableStage(session, stageKey);
  if (!OBSERVATION_FIELD_KEY_PATTERN.test(questionKey)) {
    return fail("unknown calculation prompt", "invalid_sequence");
  }
  if (!Number.isFinite(value)) {
    return fail("a calculation must be a finite number", "invalid_sequence");
  }
  const trimmedUnit = unit.trim();
  if (trimmedUnit.length === 0 || trimmedUnit.length > 24) {
    return fail("a calculation needs its unit", "invalid_sequence");
  }
  if (trialNumber !== null && !Number.isInteger(trialNumber)) {
    return fail("trial number must be an integer", "invalid_sequence");
  }
  const rest = session.public.calculations.filter(
    (entry) => entry.questionKey !== questionKey,
  );
  session.public.calculations = [
    ...rest,
    {
      stageKey,
      questionKey,
      value: roundTo(value, 8),
      unit: trimmedUnit,
      trialNumber,
    },
  ];
  return { ok: true };
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
  // Filling the burette again over a prepared flask would silently rewind the
  // stage: this function restarts the phase and clears the flask colour, but
  // the recorded weighings and indicator survive, so the student is left with
  // "everything is done" on screen and gates that refuse every route forward.
  // A refill between trials is recorded as that trial's own initial reading
  // (see `startTrialAction`), so nothing legitimate is refused here.
  if (stageHasRecordedWork(stage)) {
    return fail(
      "the burette is already set up for this stage: record the next trial's initial reading instead of filling it again",
      "invalid_sequence",
    );
  }
  // Physical precondition, not a formality: a burette lying in its cradle cannot
  // be filled. The student hangs it on the clamp first.
  if (!stage.world.buretteMounted) {
    return fail(
      "clamp the burette on the stand before filling it",
      "invalid_sequence",
    );
  }
  stage.apparatusReady = true;
  stage.buretteInitialMl = roundTo(initialReadingMl, 2);
  stage.deliveredSoFarMl = 0;
  // A freshly rinsed burette starts over an empty flask: nothing has been
  // delivered and no indicator is present yet.
  stage.flaskColour = null;
  stage.phase = "setup";
  return { ok: true };
}

/**
 * Work already recorded that a second `setup_apparatus` would destroy.
 *
 * The line is drawn at the analyte and the indicator, not at "has been filled":
 * a first fill, and correcting a mistyped initial reading on a stage where
 * nothing has been prepared yet, both stay legal. What must never happen is a
 * refill wiping a sample that is already weighed, dissolved and marked.
 */
export function stageHasRecordedWork(stage: StageSession): boolean {
  return (
    stage.analyteMassG !== null ||
    stage.analyteVolumeMl !== null ||
    stage.indicatorDrops !== null ||
    stage.trials.length > 0
  );
}

/**
 * The phase the RECORDED facts imply.
 *
 * `phase` is a stored enum that can only be trusted while nothing rewinds it.
 * Treating it as a cache of facts the stage already carries makes the session
 * self-healing: a stage whose phase was knocked back to `setup` while its KHP
 * sample or its indicator is still on record is lifted back to where its own
 * evidence puts it, so the student is never locked out of the experiment by a
 * state that contradicts itself. It never moves a phase backwards, and never
 * touches `titrating` (an open trial) or `reported` (a judged trial).
 */
export function reconcileStagePhase(stage: StageSession): StageSession["phase"] {
  if (stage.phase === "reported" || stage.phase === "titrating") return stage.phase;
  if (stage.indicatorDrops !== null) return "indicator_added";
  if (stage.analyteMassG !== null || stage.analyteVolumeMl !== null) return "analyte_ready";
  return stage.phase;
}

/** Apply `reconcileStagePhase` to every stage of a session in place. */
export function reconcileSessionPhases(session: TitrationSession): void {
  for (const stage of Object.values(session.public.stages)) {
    stage.phase = reconcileStagePhase(stage);
  }
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
  // New sample in a clean flask: no solution colour to report yet.
  stage.flaskColour = null;
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
  stage.flaskColour = null;
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
  // The indicator's configured acid colour is what the student now sees; it is
  // read from the configuration rather than hardcoded here or in the UI.
  stage.flaskColour = flaskColourFromConfigName(cfg.indicator.acidColour);
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
      maxTrialAttemptsFor(session.config.trialRules),
    );
    stage.openTrial = trial;
    stage.phase = "titrating";
    stage.deliveredSoFarMl = 0;
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
  const deliveredSoFar = trialDeliveredVolumeMl(trial) + volumeMl;
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
  const total = trialDeliveredVolumeMl(trial);
  stage.deliveredSoFarMl = total;
  const colour = observeFlaskColour(cfg.indicator, total, {
    equivalenceMl: truth.equivalenceMl,
    observableMl: truth.observableMl,
  }).colour;
  stage.flaskColour = colour;
  return { ok: true, colour };
}

/**
 * Volume actually delivered into the open/recorded trial, from the engine's own
 * record of every increment. Exported so the persistence layer can reconstruct
 * where the meniscus stood at the moment a reading was taken (§28).
 */
export function trialDeliveredVolumeMl(trial: TrialRecord): number {
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
    const expected = trialDeliveredVolumeMl(trial);
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
  const delivered = trial.deliveredMl ?? trialDeliveredVolumeMl(trial);
  const actual = observeFlaskColour(cfg.indicator, delivered, {
    equivalenceMl: truth.equivalenceMl,
    observableMl: truth.observableMl,
  }).colour;
  stage.flaskColour = actual;
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
  const cfg = stageConfig(session.config, stageKey);
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
  const observedColour = observeFlaskColour(cfg.indicator, trial.deliveredMl, {
    equivalenceMl: truth.equivalenceMl,
    observableMl: truth.observableMl,
  }).colour;
  trial.endpointJudgement = judgement;
  trial.observedColour = observedColour;
  if (judgement === "overshot") {
    trial.status = "discarded_overshoot";
    trial.rejectionReason = "overshot endpoint: discard and repeat per manual";
    recordError(session, {
      code: "over_titration",
      trialNumber: trial.trialNumber,
      stageKey,
      // SECURITY: the comparison against the hidden endpoint is deliberately
      // numeric-free. This detail string is persisted into the public snapshot
      // and shipped to the browser, so quoting the observable endpoint here
      // would hand the student the answer.
      detail: "endpoint overshot: discard the solution and repeat the trial per the manual",
      severe: false,
    });
    stage.trials.push(trial);
    stage.openTrial = null;
    // An overshot flask holds a spent solution too: it must be discarded.
    stage.preparation.lastTrialDiscarded = false;
    return { ok: true };
  }
  trial.status = "recorded";
  stage.trials.push(trial);
  stage.openTrial = null;
  stage.phase = "titrating";
  session.public.completedTrials += 1;
  // The spent solution must be discarded into waste before the next trial.
  stage.preparation.lastTrialDiscarded = false;
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
    // Never include the expected value: this detail persists into the public
    // snapshot, which the student can read. Correctness is recomputed at
    // grade time from server-side hidden state.
    recordError(session, {
      code: "reading_error",
      trialNumber,
      stageKey,
      detail: `reported molarity ${studentMolarityM} M outside the accepted tolerance`,
      severe: false,
    });
  }
  return { ok: true, correct, expected: roundTo(expected, 6) };
}

export interface GradedTrialCalculation {
  readonly trialNumber: number;
  readonly studentMolarityM: number;
  readonly expectedMolarityM: number;
  readonly toleranceM: number;
  readonly correct: boolean;
}

/**
 * Server-side grading projection for every reported trial on a stage. PURE:
 * it reads the hidden truth but mutates nothing (unlike `reportMolarity`,
 * which records the student's submission). The caller persists
 * `is_correct`/`expected_value` through the privileged path; only the
 * boolean verdict may ever reach the student.
 */
export function gradedTrialCalculations(
  session: TitrationSession,
  stageKey: string,
): GradedTrialCalculation[] {
  const stage = mutableStage(session, stageKey);
  return stage.trials
    .filter((trial) => trial.status === "recorded" && trial.reportedMolarityM !== null)
    .map((trial) => {
      const expected = expectedMolarityForTrial(session, stageKey, trial);
      const tolerance = Math.max(0.005, expected * 0.02);
      const student = trial.reportedMolarityM as number;
      return {
        trialNumber: trial.trialNumber,
        studentMolarityM: student,
        expectedMolarityM: roundTo(expected, 6),
        toleranceM: roundTo(tolerance, 6),
        correct: Math.abs(student - expected) <= tolerance + 1e-12,
      };
    });
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

/**
 * Record (or replace) one student-written observation for a stage.
 *
 * The engine stores TEXT ONLY: no score, no chemistry and no hidden value is
 * derived here, and the field key must be a plain identifier. Which field keys
 * an experiment offers is decided by the application layer from the experiment
 * definition, so unknown keys never reach storage.
 */
export function recordObservation(
  session: TitrationSession,
  stageKey: string,
  fieldKey: string,
  text: string,
): ActionResult {
  mutableStage(session, stageKey);
  if (!OBSERVATION_FIELD_KEY_PATTERN.test(fieldKey)) {
    return fail("observation field key is not a valid identifier", "invalid_sequence");
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return fail("an observation needs some text", "invalid_sequence");
  }
  if (trimmed.length > 2000) {
    return fail("observation is longer than 2000 characters", "invalid_sequence");
  }
  const existing = session.public.observations.find(
    (o) => o.stageKey === stageKey && o.fieldKey === fieldKey,
  );
  if (!existing && session.public.observations.length >= MAX_OBSERVATIONS) {
    return fail("no room for another observation", "invalid_sequence");
  }
  if (existing) {
    // Observations are replaceable: a student may refine their description.
    const index = session.public.observations.indexOf(existing);
    session.public.observations[index] = { stageKey, fieldKey, textValue: trimmed };
  } else {
    session.public.observations.push({ stageKey, fieldKey, textValue: trimmed });
  }
  return { ok: true };
}

/**
 * Procedure preparation actions (Experiment 2, Part 2).
 *
 * Each function validates only its own slot — the ORDER across steps (clean
 * before condition before fill, weigh before dissolve before transfer, discard
 * before the next trial) is enforced by the dispatch layer's trial gate, so
 * the titration core below keeps working exactly as its tests describe.
 */

/**
 * Part I, step 1: measure the stock solution the working titrant is diluted
 * from. The recorded volume is evidence of the step; it is never used to derive
 * a concentration (see `WorkingSolutionPreparation`).
 */
export function measureStockVolume(
  session: TitrationSession,
  stageKey: string,
  observedVolumeMl: number,
): ActionResult {
  mutableStage(session, stageKey);
  const solution = session.public.solution;
  if (solution.stockVolumeMl !== null) {
    return fail("the stock solution has already been measured", "invalid_sequence");
  }
  if (!(observedVolumeMl > 0) || !Number.isFinite(observedVolumeMl)) {
    return fail("the measured stock volume must be positive", "invalid_sequence");
  }
  solution.stockVolumeMl = roundTo(observedVolumeMl, 2);
  return { ok: true };
}

/** Part I, step 2: add distilled water to complete the dilution. */
export function diluteWorkingSolution(session: TitrationSession, stageKey: string): ActionResult {
  mutableStage(session, stageKey);
  const solution = session.public.solution;
  if (solution.stockVolumeMl === null) {
    return fail("measure the stock solution before diluting it", "invalid_sequence");
  }
  if (solution.diluted) {
    return fail("the working solution is already diluted", "invalid_sequence");
  }
  solution.diluted = true;
  return { ok: true };
}

/** Part I, step 3: stopper as far as possible and swirl to mix. */
export function mixWorkingSolution(session: TitrationSession, stageKey: string): ActionResult {
  mutableStage(session, stageKey);
  const solution = session.public.solution;
  if (!solution.diluted) {
    return fail("dilute the working solution before mixing it", "invalid_sequence");
  }
  if (solution.mixed) {
    return fail("the working solution is already mixed", "invalid_sequence");
  }
  solution.mixed = true;
  return { ok: true };
}

/**
 * Manual: obtain about 120 mL of the prepared NaOH in a clean, dry 250 mL beaker
 * and cover it with a watch glass. This beaker is what conditions and fills the
 * burette, so it is a step, not a detail.
 */
export function obtainTitrantPortion(session: TitrationSession, stageKey: string): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (!session.public.solution.mixed) {
    return fail("prepare the working solution before taking a portion of it", "invalid_sequence");
  }
  if (stage.preparation.beakerObtained) {
    return fail("the beaker already holds a portion of the titrant", "invalid_sequence");
  }
  stage.preparation.beakerObtained = true;
  return { ok: true };
}

/** Manual: clean the burette by rinsing with tap water. */
export function rinseBurette(session: TitrationSession, stageKey: string): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (stage.preparation.buretteCleaned) {
    return fail("the burette is already cleaned", "invalid_sequence");
  }
  stage.preparation.buretteCleaned = true;
  return { ok: true };
}

/** Manual: rinse the burette with three ~5 mL portions of the NaOH solution. */
export function conditionBurette(session: TitrationSession, stageKey: string): ActionResult {
  const stage = mutableStage(session, stageKey);
  const prep = stage.preparation;
  if (!prep.buretteCleaned) {
    return fail("clean the burette with tap water before conditioning it", "invalid_sequence");
  }
  if (!prep.beakerObtained) {
    // The conditioning rinses ARE the titrant: there is nothing to rinse with
    // until a portion has been obtained from the prepared working solution.
    return fail(
      "obtain a portion of the working solution in a beaker before conditioning the burette",
      "invalid_sequence",
    );
  }
  if (prep.conditioningRinses >= REQUIRED_CONDITIONING_RINSES) {
    return fail("the burette is already conditioned", "invalid_sequence");
  }
  prep.conditioningRinses += 1;
  return { ok: true };
}

/** Manual: drain NaOH through the tip into a small beaker to expel air. */
export function clearAirBubble(session: TitrationSession, stageKey: string): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (!stage.apparatusReady) {
    return fail("fill the burette before clearing its tip", "invalid_sequence");
  }
  if (stage.preparation.airBubbleCleared) {
    return fail("the burette tip is already cleared", "invalid_sequence");
  }
  stage.preparation.airBubbleCleared = true;
  return { ok: true };
}

/**
 * Weighing by difference (manual: weigh the empty beaker, add ~0.6 g KHP,
 * re-weigh). The first call records the empty beaker, the second records
 * beaker-plus-KHP and derives the sample mass with `massByDifference` — the
 * student can never set the sample mass directly through this action.
 */
export function weighBeakerMass(
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
  const prep = stage.preparation;
  // The pan is an instrument: there is no reading to record while it is empty.
  if (!prep.beakerOnBalance) {
    return fail(
      "stand the beaker on the balance pan before reading its mass",
      "invalid_sequence",
    );
  }
  const massG = roundTo(observedMassG, 2);
  if (prep.beakerMassG === null) {
    prep.beakerMassG = massG;
    return { ok: true };
  }
  if (prep.beakerPlusKhpMassG !== null) {
    return fail("both beaker weighings are already recorded for this stage", "invalid_sequence");
  }
  if (!prep.khpAdded) {
    return fail(
      "take the beaker off the pan and add the standard before re-weighing it",
      "invalid_sequence",
    );
  }
  if (!(massG > prep.beakerMassG)) {
    recordError(session, {
      code: "reading_error",
      trialNumber: null,
      stageKey,
      detail: `second weighing ${massG} g does not exceed the empty beaker ${prep.beakerMassG} g`,
      severe: false,
    });
    return fail("the beaker-plus-KHP weighing must exceed the empty beaker", "invalid_sequence");
  }
  prep.beakerPlusKhpMassG = massG;
  const sampleG = roundTo(massByDifference(massG, prep.beakerMassG), 2);
  stage.analyteMassG = sampleG;
  stage.phase = "analyte_ready";
  stage.flaskColour = null;
  const quality = classifyReadingError("balance", Math.abs(sampleG - cfg.analytePortion.nominalMassG));
  if (quality === "gross_error") {
    recordError(session, {
      code: "reading_error",
      trialNumber: null,
      stageKey,
      detail: `implausible KHP sample ${sampleG} g by difference`,
      severe: false,
    });
  }
  return { ok: true };
}

/** Manual: dissolve the KHP in ~30 mL distilled water with stirring. */
export function dissolveKhp(session: TitrationSession, stageKey: string): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (cfg.analytePortion.kind !== "weighed_mass") {
    return fail("this stage has no KHP to dissolve", "invalid_sequence");
  }
  if (stage.analyteMassG === null) {
    return fail("weigh the KHP sample before dissolving it", "invalid_sequence");
  }
  if (stage.preparation.khpDissolved) {
    return fail("the KHP is already dissolved", "invalid_sequence");
  }
  stage.preparation.khpDissolved = true;
  return { ok: true };
}

/** Manual: transfer the KHP solution into the clean Erlenmeyer flask. */
export function transferSolution(session: TitrationSession, stageKey: string): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (cfg.analytePortion.kind !== "weighed_mass") {
    return fail("this stage has no KHP solution to transfer", "invalid_sequence");
  }
  if (!stage.preparation.khpDissolved) {
    return fail("dissolve the KHP before transferring it", "invalid_sequence");
  }
  if (stage.preparation.khpTransferred) {
    return fail("the solution is already in the flask", "invalid_sequence");
  }
  stage.preparation.khpTransferred = true;
  // The transferred solution is what the indicator goes into: colourless until
  // the indicator is added, matching the manual's acid-side appearance.
  if (stage.flaskColour === null) {
    stage.flaskColour = "colourless";
  }
  return { ok: true };
}

/** Manual: rinse the beaker twice with ~5 mL distilled water into the flask. */
export function rinseBeaker(session: TitrationSession, stageKey: string): ActionResult {
  const cfg = stageConfig(session.config, stageKey);
  const stage = mutableStage(session, stageKey);
  if (cfg.analytePortion.kind !== "weighed_mass") {
    return fail("this stage has no beaker to rinse", "invalid_sequence");
  }
  if (!stage.preparation.khpTransferred) {
    return fail("transfer the solution before rinsing the beaker", "invalid_sequence");
  }
  if (stage.preparation.beakerRinses >= REQUIRED_BEAKER_RINSES) {
    return fail("the beaker is already rinsed twice", "invalid_sequence");
  }
  stage.preparation.beakerRinses += 1;
  return { ok: true };
}

/** Place the flask under the burette, ready to titrate. */
export function placeFlask(session: TitrationSession, stageKey: string): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (!stage.apparatusReady) {
    return fail("fill the burette before placing the flask under it", "invalid_sequence");
  }
  if (stage.preparation.flaskPlaced) {
    return fail("the flask is already under the burette", "invalid_sequence");
  }
  stage.preparation.flaskPlaced = true;
  return { ok: true };
}

/**
 * Manual: discard the flask contents into the waste container. Required after
 * every completed trial (correct or overshot) before the next trial may start.
 */
export function discardToWaste(session: TitrationSession, stageKey: string): ActionResult {
  const stage = mutableStage(session, stageKey);
  if (stage.trials.length === 0 || stage.preparation.lastTrialDiscarded) {
    return fail("there is no completed trial to discard", "invalid_sequence");
  }
  stage.preparation.lastTrialDiscarded = true;
  stage.preparation.wasteDiscards += 1;
  // The waste container fills up: it is what the student sees when they look at
  // it, and a world fact rather than a chemistry number.
  stage.world.wasteMl = roundTo(stage.world.wasteMl + 60, 2);
  // A fresh flask is colourless until the next trial's indicator chemistry.
  stage.flaskColour = null;
  return { ok: true };
}

/**
 * Minimal config for trial readiness: stage order, keys and the analyte
 * portion kind. Both the full experiment config and the whitelisted public
 * view satisfy it, so the domain, the router and the view model share one
 * implementation of "what is still missing before trial 1".
 */
export interface PreparationConfig {
  /** Part I working-titrant dilution, or null when the titrant is ready-made. */
  readonly solutionDilution: {
    readonly stockKey: string;
    readonly stockMolarityM: number;
    readonly nominalWorkingMolarityM: number;
  } | null;
  readonly stages: ReadonlyArray<{
    readonly key: string;
    readonly analytePortion: { readonly kind: "weighed_mass" | "pipetted_volume" };
  }>;
}

function stageConfigForPreparation(
  config: PreparationConfig,
  stageKey: string,
): PreparationConfig["stages"][number] {
  const stage = config.stages.find((s) => s.key === stageKey);
  if (!stage) throw new Error(`unknown stage ${stageKey}`);
  return stage;
}

/**
 * Part I preparation in procedure order, as student-facing messages. Empty when
 * the experiment has no dilution step or when it is complete — so a caller that
 * only cares about the working solution (the fill gate) can ask for exactly
 * that and nothing else.
 */
export function solutionPreparationBlockers(
  config: PreparationConfig,
  solution: WorkingSolutionPreparation,
): string[] {
  const dilution = config.solutionDilution;
  if (!dilution) return [];
  if (solution.stockVolumeMl === null) {
    return [`Measure the ${dilution.stockMolarityM} M stock solution for the working titrant.`];
  }
  if (!solution.diluted) {
    return [
      `Add distilled water to dilute the stock to about ${dilution.nominalWorkingMolarityM} M.`,
    ];
  }
  if (!solution.mixed) {
    return ["Stopper the flask as far as possible and swirl to mix the working solution."];
  }
  return [];
}

/**
 * Trial readiness in procedure order: every missing preparation step that must
 * be satisfied before trial 1 may start, as student-facing messages. Empty
 * means the stage is ready to titrate.
 */
export function preparationBlockersForTrial(
  config: PreparationConfig,
  stageKey: string,
  stage: StageSession,
  solution: WorkingSolutionPreparation,
): string[] {
  const cfg = stageConfigForPreparation(config, stageKey);
  const prep = stage.preparation;
  const blockers: string[] = [];
  // Part I comes first in the procedure and is attempt-level: the burette is
  // served from the working solution, whichever stage is being titrated.
  blockers.push(...solutionPreparationBlockers(config, solution));
  if (!prep.buretteCleaned) {
    blockers.push("Clean the burette with tap water before filling it.");
  }
  if (!prep.beakerObtained) {
    blockers.push(
      "Obtain a portion of the working solution in a clean, dry 250 mL beaker and cover it with a watch glass.",
    );
  }
  if (prep.conditioningRinses < REQUIRED_CONDITIONING_RINSES) {
    blockers.push(
      `Condition the burette with NaOH (${prep.conditioningRinses} of ${REQUIRED_CONDITIONING_RINSES} rinses done).`,
    );
  }
  if (cfg.analytePortion.kind === "weighed_mass") {
    if (prep.beakerMassG === null || prep.beakerPlusKhpMassG === null) {
      blockers.push("Weigh the empty beaker, add KHP and weigh again: the sample mass comes from the difference.");
    }
  } else if (stage.analyteVolumeMl === null) {
    blockers.push("Measure the aliquot volume before starting a trial.");
  }
  if (!prep.airBubbleCleared) {
    blockers.push("Clear the air bubble from the burette tip before starting a trial.");
  }
  if (cfg.analytePortion.kind === "weighed_mass") {
    if (!prep.khpDissolved) {
      blockers.push("Dissolve the KHP in distilled water before transferring it.");
    }
    if (!prep.khpTransferred) {
      blockers.push("Transfer the KHP solution to the Erlenmeyer flask.");
    }
    if (prep.beakerRinses < REQUIRED_BEAKER_RINSES) {
      blockers.push(
        `Rinse the beaker into the flask (${prep.beakerRinses} of ${REQUIRED_BEAKER_RINSES} rinses done).`,
      );
    }
  }
  if (stage.indicatorDrops === null) {
    blockers.push("Add the phenolphthalein indicator before starting a trial.");
  }
  if (!prep.flaskPlaced) {
    blockers.push("Place the flask under the burette before starting the trial.");
  }
  return blockers;
}

/**
 * Derived concordance for one stage. Reuses the SAME domain evaluators as
 * assessment, so "which trials agree" has exactly one implementation and the
 * UI can display it without recomputing anything.
 */
export function projectStageConcordance(
  config: TitrationExperimentConfig,
  stage: StageSession,
): StageConcordance {
  const rules = config.trialRules;
  const concordanceRules = rules.concordance;
  const recorded = stage.trials.filter((t) => t.status === "recorded");
  const discarded = stage.trials
    .filter((t) => t.status === "discarded_overshoot" || t.status === "rejected")
    .map((t) => t.trialNumber)
    .sort((a, b) => a - b);
  const titres = recorded
    .map((t) => t.deliveredMl)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const result = evaluateConcordanceForRules(rules, stage.reportedMolaritiesM, titres);

  let allowedSpread: number;
  let spreadUnit: "mol/L" | "mL";
  if (concordanceRules.mode === "molarity") {
    allowedSpread = concordanceRules.maxSpreadM;
    spreadUnit = "mol/L";
  } else {
    allowedSpread = concordanceRules.toleranceMl;
    spreadUnit = "mL";
  }

  // A spread can only be called concordant once enough evidence exists; with
  // one value the spread is undefined and the rule is simply not yet satisfied.
  const enoughEvidence =
    concordanceRules.mode === "molarity"
      ? stage.reportedMolaritiesM.length >= rules.minTrials
      : recorded.length >= rules.minTrials;

  // Manual fourth-trial rule: when the first three reported molarities disagree
  // (spread > 0.005 M) the student performs a fourth titration and the result
  // is the average of the TWO CLOSEST values. Judging all four by the full
  // spread would leave a careful fourth trial unable to ever complete the
  // stage, so at the recorded-trial ceiling the gate uses the closest-pair
  // spread — the same pair the reported average comes from.
  let spread: number | null = Number.isFinite(result.spread) ? result.spread : null;
  let concordant = result.concordant && enoughEvidence;
  let detail = result.detail;
  if (
    concordanceRules.mode === "molarity" &&
    recorded.length >= rules.maxTrials &&
    recorded.length > rules.minTrials
  ) {
    const pairSpread = closestPairSpread(stage.reportedMolaritiesM);
    spread = pairSpread;
    concordant =
      pairSpread !== null && pairSpread <= concordanceRules.maxSpreadM + 1e-12;
    detail =
      pairSpread === null
        ? result.detail
        : `fourth trial recorded: closest pair spread ${pairSpread} mol/L vs allowed ${concordanceRules.maxSpreadM} mol/L; the result is the average of the two closest values`;
  }

  return {
    mode: concordanceRules.mode,
    requiredTrials: rules.minTrials,
    maxTrials: rules.maxTrials,
    recordedTrials: recorded.length,
    discardedTrials: discarded,
    reportedMolaritiesM: [...stage.reportedMolaritiesM],
    spread,
    allowedSpread,
    spreadUnit,
    concordant,
    averageMolarityM:
      concordanceRules.mode === "molarity" && stage.reportedMolaritiesM.length > 0
        ? averageTwoClosest(stage.reportedMolaritiesM)
        : null,
    trialsStillNeeded: Math.max(0, rules.minTrials - recorded.length),
    detail,
  };
}

/**
 * Serialisable public projection: the persisted session state plus freshly
 * derived concordance. Contains NOTHING hidden by construction, and because the
 * derivations are recomputed here they can never be stale or client-authored.
 */
export function projectPublicState(session: TitrationSession): TitrationPublicState {
  const base = JSON.parse(JSON.stringify(session.public)) as TitrationSessionState;
  const stages: Record<
    string,
    StageSession & { concordance: StageConcordance; observation: StageWorldObservation }
  > = {};
  for (const [key, stage] of Object.entries(base.stages)) {
    const truth = session.hidden.stages[key];
    stages[key] = {
      ...stage,
      concordance: projectStageConcordance(session.config, stage),
      // What the glass and the pan SHOW. Derived on every read from the world
      // facts plus the attempt's own instrument truth, so a resumed attempt
      // shows the level it left rather than the last number anyone typed.
      observation: truth
        ? stageWorldObservation({
            config: session.config,
            stageKey: key,
            stage,
            hidden: truth,
            beakerTareG: session.hidden.beakerTareG,
          })
        : {
            buretteReadingMl: null,
            balanceDisplayG: null,
            balanceHasBeaker: stage.preparation.beakerOnBalance,
            cylinderVolumeMl: stage.world.cylinderVolumeMl,
            wasteMl: stage.world.wasteMl,
          },
    };
  }
  return { ...base, stages };
}

/** Serialisable public projection. Contains NOTHING hidden by construction. */
export function toPublicJSON(session: TitrationSession): TitrationPublicState {
  return projectPublicState(session);
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
