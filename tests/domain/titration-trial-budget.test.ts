import { describe, expect, it } from "vitest";
import { maxTrialAttemptsFor } from "@/domain/simulation/titration/config";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { projectExperimentWorkflow } from "@/domain/simulation/titration/workflow";
import { projectStageConcordance, toPublicJSON } from "@/domain/simulation/titration/engine";
import {
  freshSession,
  hiddenTruth,
  provisionStageA,
  round2,
  STAGE_A,
} from "../helpers/titration-fixtures";

const EXPERIMENT_ID = "exp-02";

function apply(
  session: ReturnType<typeof freshSession>,
  action: TitrationProtocolAction,
) {
  const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, action);
  expect(outcome.accepted, `${action.type} should be accepted: ${outcome.message}`).toBe(true);
  return outcome;
}

/**
 * The two budgets the procedure implies, kept apart:
 *
 *  - the manual's RECORDED trials (three, or a fourth when they disagree), and
 *  - the simulator's attempt cap, which bounds how many runs a stage may total.
 *
 * An overshot endpoint is discarded and repeated, so it must never consume the
 * recorded-trial budget — otherwise two slips would make the experiment
 * impossible to finish. It still consumes an attempt, so a stage cannot be
 * re-run forever.
 */
describe("trial budget: recorded trials vs total attempts", () => {
  /** One overshot run: deliver past the endpoint, close it, discard the flask. */
  function overshoot(
    session: ReturnType<typeof freshSession>,
    trialNumber: number,
    overshootMl: number,
  ) {
    apply(session, { type: "start_trial", stageKey: STAGE_A, trialNumber, initialReadingMl: 0 });
    apply(session, { type: "add_titrant", stageKey: STAGE_A, volumeMl: overshootMl });
    apply(session, { type: "read_burette", stageKey: STAGE_A, observedFinalMl: overshootMl });
    apply(session, { type: "complete_trial", stageKey: STAGE_A });
    const trial = session.public.stages[STAGE_A].trials.find(
      (row) => row.trialNumber === trialNumber,
    );
    expect(trial?.status).toBe("discarded_overshoot");
    apply(session, { type: "discard_to_waste", stageKey: STAGE_A });
  }

  /** One valid run, reported so it counts towards concordance. */
  function recordedTrial(
    session: ReturnType<typeof freshSession>,
    trialNumber: number,
    deliveredMl: number,
    reportedMolarityM: number,
  ) {
    apply(session, { type: "start_trial", stageKey: STAGE_A, trialNumber, initialReadingMl: 0 });
    apply(session, { type: "add_titrant", stageKey: STAGE_A, volumeMl: deliveredMl });
    apply(session, { type: "read_burette", stageKey: STAGE_A, observedFinalMl: deliveredMl });
    apply(session, { type: "complete_trial", stageKey: STAGE_A });
    apply(session, {
      type: "report_molarity",
      stageKey: STAGE_A,
      trialNumber,
      studentMolarityM: reportedMolarityM,
    });
    apply(session, { type: "discard_to_waste", stageKey: STAGE_A });
  }

  it("still allows the three recorded titres after overshot attempts", () => {
    const session = freshSession("trial-budget-seed");
    provisionStageA(session);
    const observable = round2(hiddenTruth(session, STAGE_A).observableMl);

    // Two slips, both discarded. The manual says an overshot endpoint is
    // repeated, so neither may be charged against the three titres.
    overshoot(session, 1, round2(observable + 1.5));
    overshoot(session, 2, round2(observable + 2.1));

    for (let trial = 3; trial <= 5; trial += 1) {
      recordedTrial(session, trial, observable, 0.2);
    }

    const concordance = projectStageConcordance(
      exp02TitrationConfig,
      session.public.stages[STAGE_A],
    );
    expect(concordance.recordedTrials).toBe(3);
    expect(concordance.discardedTrials).toEqual([1, 2]);
    expect(concordance.concordant).toBe(true);
    // The stage is genuinely finished, including the rejected runs in history.
    expect(session.public.stages[STAGE_A].trials).toHaveLength(5);
    const workflow = projectExperimentWorkflow(exp02TitrationConfig, toPublicJSON(session));
    expect(workflow.stages[0].complete).toBe(true);
    expect(workflow.stages[1].locked).toBe(false);
  });

  it("stops a stage at the separate attempt cap and names it in the refusal", () => {
    const cap = maxTrialAttemptsFor(exp02TitrationConfig.trialRules);
    const recordedBudget = exp02TitrationConfig.trialRules.maxTrials;
    expect(cap).toBeGreaterThan(recordedBudget);

    const session = freshSession("trial-attempt-cap-seed");
    provisionStageA(session);
    const observable = round2(hiddenTruth(session, STAGE_A).observableMl);

    for (let attempt = 1; attempt <= cap; attempt += 1) {
      overshoot(session, attempt, round2(observable + 1.5));
    }
    expect(session.public.stages[STAGE_A].trials).toHaveLength(cap);

    const refused = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: cap + 1,
      initialReadingMl: 0,
    });
    expect(refused.accepted).toBe(false);
    expect(refused.message).toMatch(new RegExp(`no more than ${cap} attempts`, "i"));
  });

  it("keeps the manual's ceiling at four recorded titres", () => {
    // Three titres, or a fourth when they disagree: the manual's budget is four
    // RECORDED trials, and nothing here forces a fourth when three agree.
    expect(exp02TitrationConfig.trialRules.maxTrials).toBe(4);
    const session = freshSession("trial-recorded-budget-seed");
    provisionStageA(session);
    const observable = round2(hiddenTruth(session, STAGE_A).observableMl);
    for (let trial = 1; trial <= 3; trial += 1) {
      recordedTrial(session, trial, observable, 0.2);
    }

    const concordance = projectStageConcordance(
      exp02TitrationConfig,
      session.public.stages[STAGE_A],
    );
    expect(concordance.concordant).toBe(true);
    expect(concordance.trialsStillNeeded).toBe(0);
    // Three concordant titres finish the stage: a fourth is not required.
    const workflow = projectExperimentWorkflow(exp02TitrationConfig, toPublicJSON(session));
    expect(workflow.stages[0].complete).toBe(true);
  });
});
