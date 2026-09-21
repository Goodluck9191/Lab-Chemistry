import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analyteConcentrationFromTitration } from "@/domain/chemistry/calculations";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  createTitrationSession,
  projectStageConcordance,
  toPublicJSON,
} from "@/domain/simulation/titration/engine";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import {
  experimentPhaseFor,
  projectExperimentWorkflow,
} from "@/domain/simulation/titration/workflow";
import { hiddenTruth, round2, STAGE_A, STAGE_B } from "../helpers/titration-fixtures";

const EXPERIMENT_ID = "exp-02";

function makeApply(session: ReturnType<typeof createTitrationSession>) {
  return (action: TitrationProtocolAction) => {
    const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, action);
    expect(outcome.accepted, `${action.type} should be accepted: ${outcome.message}`).toBe(true);
    return outcome;
  };
}

type Apply = ReturnType<typeof makeApply>;

/** Part I + full Stage A preparation through the real protocol path. */
function prepareStageA(session: ReturnType<typeof createTitrationSession>, apply: Apply) {
  apply({ type: "measure_naoh_stock", stageKey: STAGE_A, observedVolumeMl: 10 });
  apply({ type: "dilute_naoh_solution", stageKey: STAGE_A });
  apply({ type: "mix_naoh_solution", stageKey: STAGE_A });
  apply({ type: "rinse_burette", stageKey: STAGE_A });
  apply({ type: "obtain_naoh_portion", stageKey: STAGE_A });
  apply({ type: "condition_burette", stageKey: STAGE_A });
  apply({ type: "condition_burette", stageKey: STAGE_A });
  apply({ type: "condition_burette", stageKey: STAGE_A });
  apply({ type: "setup_apparatus", stageKey: STAGE_A, titrantKey: "naoh", initialReadingMl: 0 });
  apply({ type: "clear_air_bubble", stageKey: STAGE_A });
  apply({ type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.34 });
  apply({ type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.94 });
  apply({ type: "dissolve_khp", stageKey: STAGE_A });
  apply({ type: "transfer_solution", stageKey: STAGE_A });
  apply({ type: "rinse_beaker", stageKey: STAGE_A });
  apply({ type: "rinse_beaker", stageKey: STAGE_A });
  apply({ type: "add_indicator", stageKey: STAGE_A, drops: 3 });
  apply({ type: "place_flask", stageKey: STAGE_A });
}

function runTrial(
  session: ReturnType<typeof createTitrationSession>,
  apply: Apply,
  stageKey: string,
  trialNumber: number,
  deliveredMl: number,
) {
  apply({ type: "start_trial", stageKey, trialNumber, initialReadingMl: 0 });
  apply({ type: "add_titrant", stageKey, volumeMl: deliveredMl });
  apply({ type: "read_burette", stageKey, observedFinalMl: deliveredMl });
  apply({ type: "complete_trial", stageKey });
}

function phaseOf(session: ReturnType<typeof createTitrationSession>) {
  const workflow = projectExperimentWorkflow(exp02TitrationConfig, toPublicJSON(session));
  return experimentPhaseFor(exp02TitrationConfig, toPublicJSON(session), workflow);
}

/**
 * Phase 5 error-scenario coverage through the REAL dispatch path (the same
 * entry point the autosaving server action uses). Complements
 * exp02-workflow.test.ts: that file proves the happy path; this file proves a
 * student can make mistakes, repeat trials, need a fourth trial, and still
 * finish — with rejected trials never entering the final average.
 */
describe("experiment 2 error scenarios and completion", () => {
  it("rejects an overshot trial, requires disposal, and excludes it from the average", () => {
    const session = createTitrationSession(exp02TitrationConfig, "exp02-overshoot-seed");
    const apply = makeApply(session);
    prepareStageA(session, apply);
    const endpoint = round2(hiddenTruth(session, STAGE_A).observableMl);

    // Trial 1 overshoots by far more than one drop.
    runTrial(session, apply, STAGE_A, 1, round2(endpoint + 1.5));
    const rejected = session.public.stages[STAGE_A].trials.find((t) => t.trialNumber === 1);
    expect(rejected?.status).toBe("discarded_overshoot");

    // A rejected trial cannot carry a calculation: reporting is refused.
    const reportRefused = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "report_molarity",
      stageKey: STAGE_A,
      trialNumber: 1,
      studentMolarityM: 0.2,
    });
    expect(reportRefused.accepted).toBe(false);

    // The next trial cannot start until the overshot solution is discarded.
    const earlyStart = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 2,
      initialReadingMl: 0,
    });
    expect(earlyStart.accepted).toBe(false);

    apply({ type: "discard_to_waste", stageKey: STAGE_A });

    // Three valid trials, all agreeing.
    for (const trial of [2, 3, 4]) {
      runTrial(session, apply, STAGE_A, trial, endpoint);
      apply({ type: "report_molarity", stageKey: STAGE_A, trialNumber: trial, studentMolarityM: 0.2 });
      apply({ type: "discard_to_waste", stageKey: STAGE_A });
    }

    const concordance = projectStageConcordance(
      exp02TitrationConfig,
      session.public.stages[STAGE_A],
    );
    expect(concordance.discardedTrials).toEqual([1]);
    expect(concordance.recordedTrials).toBe(3);
    expect(concordance.concordant).toBe(true);
    // The rejected trial never enters the final average.
    expect(concordance.averageMolarityM).toBeCloseTo(0.2, 6);

    const workflow = projectExperimentWorkflow(exp02TitrationConfig, toPublicJSON(session));
    expect(workflow.stages[0].complete).toBe(true);
    expect(workflow.stages[1].locked).toBe(false);
  });

  it("requires a fourth trial after three disagreeing reports and completes on the two closest", () => {
    const session = createTitrationSession(exp02TitrationConfig, "exp02-fourth-trial-seed");
    const apply = makeApply(session);
    prepareStageA(session, apply);
    const endpoint = round2(hiddenTruth(session, STAGE_A).observableMl);

    const reports = [0.2, 0.206, 0.212];
    for (let trial = 1; trial <= 3; trial += 1) {
      runTrial(session, apply, STAGE_A, trial, endpoint);
      apply({
        type: "report_molarity",
        stageKey: STAGE_A,
        trialNumber: trial,
        studentMolarityM: reports[trial - 1],
      });
      apply({ type: "discard_to_waste", stageKey: STAGE_A });
    }

    // Spread 0.012 M > 0.005 M: not concordant, but the recorded budget still
    // has room for exactly one more trial.
    let concordance = projectStageConcordance(
      exp02TitrationConfig,
      session.public.stages[STAGE_A],
    );
    expect(concordance.concordant).toBe(false);
    let workflow = projectExperimentWorkflow(exp02TitrationConfig, toPublicJSON(session));
    expect(workflow.stages[0].complete).toBe(false);

    // The fourth trial agrees with the first; the closest pair completes the stage.
    runTrial(session, apply, STAGE_A, 4, endpoint);
    apply({ type: "report_molarity", stageKey: STAGE_A, trialNumber: 4, studentMolarityM: 0.201 });
    apply({ type: "discard_to_waste", stageKey: STAGE_A });

    concordance = projectStageConcordance(exp02TitrationConfig, session.public.stages[STAGE_A]);
    expect(concordance.recordedTrials).toBe(4);
    expect(concordance.concordant).toBe(true);
    expect(concordance.averageMolarityM).toBeCloseTo(0.2005, 6);

    workflow = projectExperimentWorkflow(exp02TitrationConfig, toPublicJSON(session));
    expect(workflow.stages[0].complete).toBe(true);
    expect(workflow.stages[1].locked).toBe(false);

    // The recorded-trial ceiling still holds: no fifth recorded trial.
    const refused = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 5,
      initialReadingMl: 0,
    });
    expect(refused.accepted).toBe(false);
  });

  it("grades a correctly computed HCl molarity as correct (1:1 stoichiometry)", () => {
    const session = createTitrationSession(exp02TitrationConfig, "exp02-hcl-maths-seed");
    const apply = makeApply(session);
    prepareStageA(session, apply);
    const endpointA = round2(hiddenTruth(session, STAGE_A).observableMl);
    for (let trial = 1; trial <= 3; trial += 1) {
      runTrial(session, apply, STAGE_A, trial, endpointA);
      apply({ type: "report_molarity", stageKey: STAGE_A, trialNumber: trial, studentMolarityM: 0.2 });
      apply({ type: "discard_to_waste", stageKey: STAGE_A });
    }

    // Stage B: the documented measuring-cylinder workflow (no HCl burette).
    apply({ type: "rinse_burette", stageKey: STAGE_B });
    apply({ type: "obtain_naoh_portion", stageKey: STAGE_B });
    apply({ type: "condition_burette", stageKey: STAGE_B });
    apply({ type: "condition_burette", stageKey: STAGE_B });
    apply({ type: "condition_burette", stageKey: STAGE_B });
    apply({ type: "setup_apparatus", stageKey: STAGE_B, titrantKey: "naoh", initialReadingMl: 0 });
    apply({ type: "pipette_analyte", stageKey: STAGE_B, observedVolumeMl: 25 });
    apply({ type: "clear_air_bubble", stageKey: STAGE_B });
    apply({ type: "add_indicator", stageKey: STAGE_B, drops: 3 });
    apply({ type: "place_flask", stageKey: STAGE_B });

    const endpointB = round2(hiddenTruth(session, STAGE_B).observableMl);
    runTrial(session, apply, STAGE_B, 1, endpointB);

    // The student's calculation from their own readings, using the same 1:1
    // domain formula the server grades with.
    const truth = hiddenTruth(session, STAGE_B);
    const expected = analyteConcentrationFromTitration({
      titrantMolarityMolPerL: truth.trueTitrantMolarityM,
      titrantVolumeValue: endpointB,
      titrantVolumeUnit: "mL",
      analyteVolumeValue: 25,
      analyteVolumeUnit: "mL",
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 },
    });
    const outcome = apply({
      type: "report_molarity",
      stageKey: STAGE_B,
      trialNumber: 1,
      studentMolarityM: Math.round(expected * 1_000_000) / 1_000_000,
    });
    expect(outcome.calculationCorrect).toBe(true);
    // The grading verdict is a boolean: no expected value crosses to the client.
    expect("expected" in (outcome as unknown as Record<string, unknown>)).toBe(false);
  });

  it("walks the conceptual phases without duplicating state logic", () => {
    const session = createTitrationSession(exp02TitrationConfig, "exp02-phases-seed");
    const apply = makeApply(session);
    expect(phaseOf(session)).toBe("PREPARATION");

    apply({ type: "measure_naoh_stock", stageKey: STAGE_A, observedVolumeMl: 10 });
    expect(phaseOf(session)).toBe("SOLUTION_PREPARATION");

    apply({ type: "dilute_naoh_solution", stageKey: STAGE_A });
    apply({ type: "mix_naoh_solution", stageKey: STAGE_A });
    expect(phaseOf(session)).toBe("APPARATUS_SETUP");

    // Stage A preparation only (Part I is already done above).
    apply({ type: "rinse_burette", stageKey: STAGE_A });
    apply({ type: "obtain_naoh_portion", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "setup_apparatus", stageKey: STAGE_A, titrantKey: "naoh", initialReadingMl: 0 });
    apply({ type: "clear_air_bubble", stageKey: STAGE_A });
    apply({ type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.34 });
    apply({ type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.94 });
    apply({ type: "dissolve_khp", stageKey: STAGE_A });
    apply({ type: "transfer_solution", stageKey: STAGE_A });
    apply({ type: "rinse_beaker", stageKey: STAGE_A });
    apply({ type: "rinse_beaker", stageKey: STAGE_A });
    apply({ type: "add_indicator", stageKey: STAGE_A, drops: 3 });
    apply({ type: "place_flask", stageKey: STAGE_A });
    expect(phaseOf(session)).toBe("TITRATION_READY");

    const endpoint = round2(hiddenTruth(session, STAGE_A).observableMl);
    apply({ type: "start_trial", stageKey: STAGE_A, trialNumber: 1, initialReadingMl: 0 });
    expect(phaseOf(session)).toBe("TITRATION");

    apply({ type: "add_titrant", stageKey: STAGE_A, volumeMl: endpoint });
    apply({ type: "read_burette", stageKey: STAGE_A, observedFinalMl: endpoint });
    apply({ type: "complete_trial", stageKey: STAGE_A });
    // Recorded but not yet reported: the calculation is due.
    expect(phaseOf(session)).toBe("CALCULATION");

    apply({ type: "report_molarity", stageKey: STAGE_A, trialNumber: 1, studentMolarityM: 0.2 });
    // Reported but the flask is still full: disposal comes before the next trial.
    expect(phaseOf(session)).toBe("TRIAL_RECORDED");

    apply({ type: "discard_to_waste", stageKey: STAGE_A });
    expect(phaseOf(session)).toBe("NEXT_TRIAL");
  });

  it("keeps hidden chemistry out of the serialised public state", () => {
    const session = createTitrationSession(exp02TitrationConfig, "exp02-leak-seed");
    const apply = makeApply(session);
    prepareStageA(session, apply);
    const endpoint = round2(hiddenTruth(session, STAGE_A).observableMl);
    runTrial(session, apply, STAGE_A, 1, endpoint);
    const serialised = JSON.stringify(toPublicJSON(session));
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(`"${key}"`);
    }
  });
});
