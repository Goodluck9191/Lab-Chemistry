import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  addIndicator,
  addTitrant,
  completeTrial,
  createTitrationSession,
  pipetteAnalyte,
  readBurette,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  toPublicJSON,
  weighAnalyte,
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

/** Set the burette up with a chosen initial reading. */
export function setup(session: TitrationSession, stageKey = STAGE_A, initialReadingMl = 0): void {
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

/** A stage-B session prepared with a pipetted aliquot, ready to titrate. */
export function stageBReadySession(seed = DEFAULT_SEED): TitrationSession {
  const session = freshSession(seed);
  setupApparatus(session, STAGE_B, "naoh", 0);
  pipetteAnalyte(session, STAGE_B, exp02TitrationConfig.stages[1].analytePortion.kind === "pipetted_volume"
    ? exp02TitrationConfig.stages[1].analytePortion.nominalVolumeMl
    : 25);
  addIndicator(session, STAGE_B, 3);
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
  setupApparatus(session, STAGE_B, "naoh", 0);
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
