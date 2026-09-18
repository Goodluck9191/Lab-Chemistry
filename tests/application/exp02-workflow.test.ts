import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { createTitrationSession, toPublicJSON } from "@/domain/simulation/titration/engine";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import {
  resumeSessionFromSnapshot,
  secretsForStorage,
  snapshotFromSession,
} from "@/domain/simulation/titration/snapshot";
import { projectExperimentWorkflow } from "@/domain/simulation/titration/workflow";
import { submitBlockersFor } from "@/application/attempts/submit-attempt";
import { hiddenTruth, round2, STAGE_A, STAGE_B } from "../helpers/titration-fixtures";

const EXPERIMENT_ID = "exp-02";
const REQUIRED_OBSERVATION = [
  { fieldKey: "colour_change", prompt: "Describe the colour change observed at the endpoint." },
];

/**
 * End-to-end Experiment 2 journey through the REAL dispatch path — the same
 * entry point the autosaving server action uses — from a fresh attempt to a
 * submittable one, following the Part 2 procedure: burette cleaning and
 * conditioning, fill, air-bubble removal, weighing by difference, dissolution,
 * transfer, beaker rinses, indicator, flask placement, three reported trials
 * with waste disposal between them, then the same for the HCl stage. No
 * database, no mocks of the domain: if any rule in the chain changes, this
 * journey notices.
 */
describe("experiment 2 end-to-end workflow", () => {
  it("standardises NaOH, determines HCl, observes and becomes submittable", () => {
    const seed = "exp02-end-to-end-seed";
    const session = createTitrationSession(exp02TitrationConfig, seed);
    const apply = (action: TitrationProtocolAction) => {
      const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, action);
      expect(outcome.accepted, `${action.type} on ${action.stageKey} should be accepted`).toBe(
        true,
      );
      return outcome;
    };

    // A fresh attempt cannot start on Stage B: the stage order is enforced.
    const locked = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "setup_apparatus",
      stageKey: STAGE_B,
      titrantKey: "naoh",
      initialReadingMl: 0,
    });
    expect(locked.accepted).toBe(false);
    expect(locked.code).toBe("stage_locked");

    // Filling an unprepared burette is refused: Part I comes first.
    const unprepared = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "setup_apparatus",
      stageKey: STAGE_A,
      titrantKey: "naoh",
      initialReadingMl: 0,
    });
    expect(unprepared.accepted).toBe(false);
    expect(unprepared.code).toBe("preparation_incomplete");

    // Part I first: the working titrant is made from the 2 M stock, and the
    // burette cannot be filled before it exists.
    apply({ type: "measure_naoh_stock", stageKey: STAGE_A, observedVolumeMl: 10 });
    apply({ type: "dilute_naoh_solution", stageKey: STAGE_A });
    apply({ type: "mix_naoh_solution", stageKey: STAGE_A });

    // Stage A preparation: clean, condition x3, fill, weigh by difference.
    apply({ type: "rinse_burette", stageKey: STAGE_A });
    apply({ type: "obtain_naoh_portion", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "setup_apparatus", stageKey: STAGE_A, titrantKey: "naoh", initialReadingMl: 0 });
    apply({ type: "clear_air_bubble", stageKey: STAGE_A });
    apply({ type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.34 });
    apply({ type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.94 });
    expect(session.public.stages[STAGE_A].analyteMassG).toBe(0.6);

    // Trial 1 cannot start mid-preparation: dissolution is still missing.
    const early = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 1,
      initialReadingMl: 0,
    });
    expect(early.accepted).toBe(false);
    expect(early.code).toBe("preparation_incomplete");

    apply({ type: "dissolve_khp", stageKey: STAGE_A });
    apply({ type: "transfer_solution", stageKey: STAGE_A });
    apply({ type: "rinse_beaker", stageKey: STAGE_A });
    apply({ type: "rinse_beaker", stageKey: STAGE_A });
    apply({ type: "add_indicator", stageKey: STAGE_A, drops: 3 });
    apply({ type: "place_flask", stageKey: STAGE_A });

    // Three concordant trials, each reported and discarded to waste.
    const endpointA = round2(hiddenTruth(session, STAGE_A).observableMl);
    for (let trial = 1; trial <= 3; trial += 1) {
      apply({ type: "start_trial", stageKey: STAGE_A, trialNumber: trial, initialReadingMl: 0 });
      apply({ type: "add_titrant", stageKey: STAGE_A, volumeMl: endpointA });
      apply({ type: "read_burette", stageKey: STAGE_A, observedFinalMl: endpointA });
      apply({ type: "complete_trial", stageKey: STAGE_A });
      apply({
        type: "report_molarity",
        stageKey: STAGE_A,
        trialNumber: trial,
        studentMolarityM: 0.2,
      });
      apply({ type: "discard_to_waste", stageKey: STAGE_A });
    }

    // Stage A concordant unlocks Stage B through the same dispatch path.
    let workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(session),
      REQUIRED_OBSERVATION,
    );
    expect(workflow.stages[0].complete).toBe(true);
    expect(workflow.stages[1].locked).toBe(false);
    expect(workflow.activeStageKey).toBe(STAGE_B);

    // Stage B preparation and three concordant trials with discards. Part I is
    // attempt-level, so only the per-stage cleaning, portion and conditioning
    // repeat.
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
    for (let trial = 1; trial <= 3; trial += 1) {
      apply({ type: "start_trial", stageKey: STAGE_B, trialNumber: trial, initialReadingMl: 0 });
      apply({ type: "add_titrant", stageKey: STAGE_B, volumeMl: endpointB });
      apply({ type: "read_burette", stageKey: STAGE_B, observedFinalMl: endpointB });
      apply({ type: "complete_trial", stageKey: STAGE_B });
      apply({
        type: "report_molarity",
        stageKey: STAGE_B,
        trialNumber: trial,
        studentMolarityM: 0.19,
      });
      apply({ type: "discard_to_waste", stageKey: STAGE_B });
    }

    // The required observation is still missing, so submission stays blocked —
    // and the application gate agrees with the domain projection.
    workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(session),
      REQUIRED_OBSERVATION,
    );
    expect(workflow.allStagesComplete).toBe(true);
    expect(workflow.canSubmit).toBe(false);
    expect(submitBlockersFor(EXPERIMENT_ID, exp02TitrationConfig, toPublicJSON(session))).toEqual(
      workflow.blockers,
    );

    apply({
      type: "record_observation",
      stageKey: STAGE_A,
      fieldKey: "colour_change",
      text: "Colourless to a faint pink that persists for a minute.",
    });

    workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(session),
      REQUIRED_OBSERVATION,
    );
    expect(workflow.recordedTrials).toBe(6);
    expect(workflow.requiredTrials).toBe(6);
    expect(workflow.percent).toBe(100);
    expect(workflow.blockers).toEqual([]);
    expect(workflow.canSubmit).toBe(true);
    expect(submitBlockersFor(EXPERIMENT_ID, exp02TitrationConfig, toPublicJSON(session))).toEqual(
      [],
    );
  });

  it("resumes the prepared bench work from the persisted snapshot unchanged", () => {
    const seed = "exp02-resume-seed";
    const session = createTitrationSession(exp02TitrationConfig, seed);
    const apply = (action: TitrationProtocolAction) => {
      const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, action);
      expect(outcome.accepted).toBe(true);
      return outcome;
    };
    apply({ type: "measure_naoh_stock", stageKey: STAGE_A, observedVolumeMl: 10 });
    apply({ type: "dilute_naoh_solution", stageKey: STAGE_A });
    apply({ type: "mix_naoh_solution", stageKey: STAGE_A });
    apply({ type: "rinse_burette", stageKey: STAGE_A });
    apply({ type: "obtain_naoh_portion", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "condition_burette", stageKey: STAGE_A });
    apply({ type: "setup_apparatus", stageKey: STAGE_A, titrantKey: "naoh", initialReadingMl: 0 });
    apply({ type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.34 });

    // Persist and resume exactly like the server does: secrets to the vault,
    // snapshot to `attempt_state`, hidden truth rebuilt from the secrets.
    const secrets = secretsForStorage(seed, session);
    const snapshot = snapshotFromSession(session);
    const resumed = resumeSessionFromSnapshot(exp02TitrationConfig, secrets, snapshot);

    const before = toPublicJSON(session);
    const after = toPublicJSON(resumed);
    expect(after).toEqual(before);
    // Preparation survived the round trip, including the half-done weighing.
    expect(after.stages[STAGE_A].preparation.beakerMassG).toBe(52.34);
    expect(after.stages[STAGE_A].preparation.beakerPlusKhpMassG).toBeNull();
    const workflow = projectExperimentWorkflow(exp02TitrationConfig, after, REQUIRED_OBSERVATION);
    expect(workflow.stages[1].locked).toBe(true);
    expect(workflow.activeStageKey).toBe(STAGE_A);
  });
});
