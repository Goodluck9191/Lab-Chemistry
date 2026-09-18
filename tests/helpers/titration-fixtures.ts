import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  addIndicator,
  addTitrant,
  clearAirBubble,
  completeTrial,
  conditionBurette,
  createTitrationSession,
  discardToWaste,
  diluteWorkingSolution,
  dissolveKhp,
  measureStockVolume,
  mixWorkingSolution,
  obtainTitrantPortion,
  pipetteAnalyte,
  placeFlask,
  readBurette,
  reportMolarity,
  rinseBeaker,
  rinseBurette,
  setupApparatus,
  startTrialAction,
  toPublicJSON,
  transferSolution,
  weighAnalyte,
  weighBeakerMass,
  type TitrationPublicState,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";

/**
 * Fixtures built with the REAL engine.
 *
 * Tests that drive the engine through its own actions cannot drift from the
 * behaviour they are meant to describe: if the engine changes, these helpers
 * produce different states and the assertions notice.
 */
export const STAGE_A = "stage-a-khp-naoh";
export const STAGE_B = "stage-b-hcl-naoh";
export const DEFAULT_SEED = "phase-4-fixture-seed";

export function freshSession(seed: string = DEFAULT_SEED): TitrationSession {
  return createTitrationSession(exp02TitrationConfig, seed);
}

export function publicStateOf(session: TitrationSession): TitrationPublicState {
  return toPublicJSON(session);
}

/** The hidden observable endpoint, available to tests but never to the browser. */
export function hiddenTruth(session: TitrationSession, stageKey: string) {
  return session.hidden.stages[stageKey];
}

/**
 * The volume of 2 M stock the fixtures "measure". It is what C1V1 = C2V2 would
 * need for 100 mL of ~0.2 M, but nothing in the engine reads it: the working
 * strength stays the configuration's nominal value plus hidden truth, so the
 * fixtures do not smuggle a concentration in through the dilution.
 */
export const FIXTURE_STOCK_VOLUME_ML = 10;

/**
 * Part I, through the real engine functions: measure the stock, dilute it with
 * distilled water and mix it. Idempotent, so a fixture may call it even when an
 * earlier helper already prepared the solution.
 */
export function provisionWorkingSolution(session: TitrationSession, stageKey = STAGE_A): void {
  const solution = session.public.solution;
  if (solution.stockVolumeMl === null) {
    expectOk(measureStockVolume(session, stageKey, FIXTURE_STOCK_VOLUME_ML));
  }
  if (!solution.diluted) expectOk(diluteWorkingSolution(session, stageKey));
  if (!solution.mixed) expectOk(mixWorkingSolution(session, stageKey));
}

/**
 * Set the burette up with a chosen initial reading, from a legitimately prepared
 * bench: the working solution is made up and the beaker the burette is served
 * from holds its portion, exactly as the procedure requires.
 */
export function setup(session: TitrationSession, stageKey = STAGE_A, initialReadingMl = 0): void {
  provisionWorkingSolution(session, stageKey);
  if (!session.public.stages[stageKey].preparation.beakerObtained) {
    expectOk(obtainTitrantPortion(session, stageKey));
  }
  setupApparatus(session, stageKey, "naoh", initialReadingMl);
}

/** Prepare the analyte and the indicator, ready to titrate. */
export function prepareStageA(
  session: TitrationSession,
  { massG = 0.6, drops = 3, stageKey = STAGE_A }: { massG?: number; drops?: number; stageKey?: string } = {},
): void {
  weighAnalyte(session, stageKey, massG);
  addIndicator(session, stageKey, drops);
}

/** Titrate one trial to a chosen delivered volume and close it. */
export function runTrial(
  session: TitrationSession,
  {
    trialNumber,
    deliveredMl,
    initialReadingMl = 0,
    stageKey = STAGE_A,
  }: { trialNumber: number; deliveredMl: number; initialReadingMl?: number; stageKey?: string },
): void {
  startTrialAction(session, stageKey, trialNumber, initialReadingMl);
  addTitrant(session, stageKey, deliveredMl);
  readBurette(session, stageKey, initialReadingMl + deliveredMl);
  completeTrial(session, stageKey);
}

/**
 * A session with three concordant stage-A trials already recorded and reported,
 * which is the state a student reaches at the end of Stage A.
 */
export function concordantStageASession(seed = DEFAULT_SEED): TitrationSession {
  const session = freshSession(seed);
  setup(session);
  const observable = session.hidden.stages[STAGE_A].observableMl;
  for (let trial = 1; trial <= 3; trial += 1) {
    prepareStageA(session);
    runTrial(session, { trialNumber: trial, deliveredMl: observable });
    reportMolarity(session, STAGE_A, trial, 0.1);
  }
  return session;
}

/**
 * A session with three recorded stage-A trials whose reported concentrations
 * disagree, so the stage is deliberately NOT concordant and stage A therefore
 * stays the stage the student is working in.
 */
export function scattershotStageASession(seed = DEFAULT_SEED): TitrationSession {
  const session = freshSession(seed);
  setup(session);
  const observable = session.hidden.stages[STAGE_A].observableMl;
  const reports = [0.1, 0.15, 0.2];
  for (let trial = 1; trial <= 3; trial += 1) {
    prepareStageA(session);
    runTrial(session, { trialNumber: trial, deliveredMl: observable });
    reportMolarity(session, STAGE_A, trial, reports[trial - 1]);
  }
  return session;
}

/** A session whose first trial overshot the endpoint and was discarded. */
export function overshotStageASession(seed = DEFAULT_SEED): TitrationSession {
  const session = freshSession(seed);
  setup(session);
  const observable = session.hidden.stages[STAGE_A].observableMl;
  prepareStageA(session);
  runTrial(session, { trialNumber: 1, deliveredMl: round2(observable + 1.5) });
  return session;
}

/** A stage-B session prepared with a measured aliquot, ready to titrate. */
export function stageBReadySession(seed = DEFAULT_SEED): TitrationSession {
  const session = freshSession(seed);
  setup(session, STAGE_B);
  pipetteAnalyte(session, STAGE_B, exp02TitrationConfig.stages[1].analytePortion.kind === "pipetted_volume"
    ? exp02TitrationConfig.stages[1].analytePortion.nominalVolumeMl
    : 25);
  addIndicator(session, STAGE_B, 3);
  return session;
}

/**
 * Run the full Experiment 2 preparation chain for Stage A through the REAL
 * engine functions: burette cleaning and conditioning, fill, air-bubble
 * removal, weighing by difference, dissolution, transfer, beaker rinses,
 * indicator and flask placement. Afterwards trial 1 may start.
 */
export function provisionStageA(
  session: TitrationSession,
  { beakerMassG = 52.34, khpMassG = 0.6 }: { beakerMassG?: number; khpMassG?: number } = {},
): void {
  provisionWorkingSolution(session);
  expectOk(rinseBurette(session, STAGE_A));
  expectOk(obtainTitrantPortion(session, STAGE_A));
  expectOk(conditionBurette(session, STAGE_A));
  expectOk(conditionBurette(session, STAGE_A));
  expectOk(conditionBurette(session, STAGE_A));
  setup(session);
  expectOk(clearAirBubble(session, STAGE_A));
  expectOk(weighBeakerMass(session, STAGE_A, beakerMassG));
  expectOk(weighBeakerMass(session, STAGE_A, round2(beakerMassG + khpMassG)));
  expectOk(dissolveKhp(session, STAGE_A));
  expectOk(transferSolution(session, STAGE_A));
  expectOk(rinseBeaker(session, STAGE_A));
  expectOk(rinseBeaker(session, STAGE_A));
  expectOk(addIndicator(session, STAGE_A, 3));
  expectOk(placeFlask(session, STAGE_A));
}

function expectOk(result: { ok: boolean; error?: string }): void {
  if (!result.ok) throw new Error(`fixture preparation failed: ${result.error ?? "unknown"}`);
}

/**
 * Full Stage B preparation: a fresh portion of the already-prepared working
 * solution, cleaning, conditioning, fill, the measured aliquot, indicator and
 * placement. Part I is attempt-level, so it is not repeated here.
 */
export function provisionStageB(session: TitrationSession): void {
  expectOk(rinseBurette(session, STAGE_B));
  expectOk(obtainTitrantPortion(session, STAGE_B));
  expectOk(conditionBurette(session, STAGE_B));
  expectOk(conditionBurette(session, STAGE_B));
  expectOk(conditionBurette(session, STAGE_B));
  setup(session, STAGE_B);
  pipetteAnalyte(session, STAGE_B, 25);
  expectOk(clearAirBubble(session, STAGE_B));
  addIndicator(session, STAGE_B, 3);
  expectOk(placeFlask(session, STAGE_B));
}

/**
 * A session that performed the whole procedure: full Stage A preparation,
 * three reported trials with discards, full Stage B preparation, three
 * reported trials with discards. Submittable once the required observation is
 * recorded.
 */
export function provisionedFullSession(seed = DEFAULT_SEED): TitrationSession {
  const session = freshSession(seed);
  provisionStageA(session);
  const observableA = session.hidden.stages[STAGE_A].observableMl;
  for (let trial = 1; trial <= 3; trial += 1) {
    runTrial(session, { trialNumber: trial, deliveredMl: round2(observableA) });
    reportMolarity(session, STAGE_A, trial, 0.1);
    expectOk(discardToWaste(session, STAGE_A));
  }
  provisionStageB(session);
  const observableB = session.hidden.stages[STAGE_B].observableMl;
  for (let trial = 1; trial <= 3; trial += 1) {
    runTrial(session, { trialNumber: trial, deliveredMl: round2(observableB), stageKey: STAGE_B });
    reportMolarity(session, STAGE_B, trial, 0.2);
    expectOk(discardToWaste(session, STAGE_B));
  }
  return session;
}

/**
 * A session where BOTH stages hold three concordant reported trials — the
 * state a student reaches at the end of the bench work, before observations
 * and submission. Reported constants agree, so concordance holds; whether the
 * constants match hidden truth is irrelevant to the workflow.
 */
export function concordantFullSession(seed = DEFAULT_SEED): TitrationSession {
  const session = concordantStageASession(seed);
  const observableB = session.hidden.stages[STAGE_B].observableMl;
  setup(session, STAGE_B);
  pipetteAnalyte(session, STAGE_B, 25);
  addIndicator(session, STAGE_B, 3);
  for (let trial = 1; trial <= 3; trial += 1) {
    prepareStageA(session, { stageKey: STAGE_B });
    runTrial(session, { trialNumber: trial, deliveredMl: round2(observableB), stageKey: STAGE_B });
    reportMolarity(session, STAGE_B, trial, 0.2);
  }
  return session;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
