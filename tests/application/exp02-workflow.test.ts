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
 * submittable one. No database, no mocks of the domain: if any rule in the
 * chain changes, this journey notices.
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

    // Stage A: weigh KHP, three concordant trials, three reported molarities.
    apply({ type: "setup_apparatus", stageKey: STAGE_A, titrantKey: "naoh", initialReadingMl: 0 });
    apply({ type: "weigh_analyte", stageKey: STAGE_A, observedMassG: 0.6 });
    apply({ type: "add_indicator", stageKey: STAGE_A, drops: 3 });
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

    // Stage B: pipette the HCl aliquot, three concordant trials, three reports.
    apply({ type: "setup_apparatus", stageKey: STAGE_B, titrantKey: "naoh", initialReadingMl: 0 });
    apply({ type: "pipette_analyte", stageKey: STAGE_B, observedVolumeMl: 25 });
    apply({ type: "add_indicator", stageKey: STAGE_B, drops: 3 });
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

  it("resumes the finished bench work from the persisted snapshot unchanged", () => {
    const seed = "exp02-resume-seed";
    const session = createTitrationSession(exp02TitrationConfig, seed);
    const apply = (action: TitrationProtocolAction) => {
      const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, action);
      expect(outcome.accepted).toBe(true);
      return outcome;
    };
    apply({ type: "setup_apparatus", stageKey: STAGE_A, titrantKey: "naoh", initialReadingMl: 0 });
    apply({ type: "weigh_analyte", stageKey: STAGE_A, observedMassG: 0.6 });
    apply({ type: "add_indicator", stageKey: STAGE_A, drops: 3 });
    const endpointA = round2(hiddenTruth(session, STAGE_A).observableMl);
    apply({ type: "start_trial", stageKey: STAGE_A, trialNumber: 1, initialReadingMl: 0 });
    apply({ type: "add_titrant", stageKey: STAGE_A, volumeMl: endpointA });
    apply({ type: "read_burette", stageKey: STAGE_A, observedFinalMl: endpointA });
    apply({ type: "complete_trial", stageKey: STAGE_A });

    // Persist and resume exactly like the server does: secrets to the vault,
    // snapshot to `attempt_state`, hidden truth rebuilt from the secrets.
    const secrets = secretsForStorage(seed, session);
    const snapshot = snapshotFromSession(session);
    const resumed = resumeSessionFromSnapshot(exp02TitrationConfig, secrets, snapshot);

    const before = toPublicJSON(session);
    const after = toPublicJSON(resumed);
    expect(after).toEqual(before);
    const workflow = projectExperimentWorkflow(exp02TitrationConfig, after, REQUIRED_OBSERVATION);
    expect(workflow.stages[0].recordedTrials).toBe(1);
    expect(workflow.stages[1].locked).toBe(true);
    expect(workflow.activeStageKey).toBe(STAGE_A);
  });
});
