import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { recordObservation, toPublicJSON } from "@/domain/simulation/titration/engine";
import { projectExperimentWorkflow } from "@/domain/simulation/titration/workflow";
import {
  concordantFullSession,
  concordantStageASession,
  freshSession,
  prepareStageA,
  setup,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

const REQUIRED_OBSERVATION = [{ fieldKey: "colour_change", prompt: "Describe the colour change." }];

describe("projectExperimentWorkflow", () => {
  it("locks Stage B behind an unstarted Stage A", () => {
    const workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(freshSession()),
      REQUIRED_OBSERVATION,
    );

    expect(workflow.stages).toHaveLength(2);
    expect(workflow.stages[0]).toMatchObject({
      key: STAGE_A,
      letter: "A",
      locked: false,
      complete: false,
    });
    expect(workflow.stages[1]).toMatchObject({
      key: STAGE_B,
      letter: "B",
      locked: true,
      lockedByKey: STAGE_A,
      complete: false,
    });
    expect(workflow.activeStageKey).toBe(STAGE_A);
    expect(workflow.allStagesComplete).toBe(false);
    expect(workflow.canSubmit).toBe(false);
    expect(workflow.blockers.length).toBeGreaterThan(0);
  });

  it("unlocks Stage B once Stage A is concordant", () => {
    const workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(concordantStageASession()),
      REQUIRED_OBSERVATION,
    );

    expect(workflow.stages[0]).toMatchObject({ locked: false, complete: true });
    expect(workflow.stages[1]).toMatchObject({ locked: false, complete: false });
    expect(workflow.activeStageKey).toBe(STAGE_B);
    expect(workflow.recordedTrials).toBe(3);
    expect(workflow.requiredTrials).toBe(6);
    expect(workflow.percent).toBe(50);
    expect(workflow.label).toBe("3 of 6 required trials recorded");
    expect(workflow.canSubmit).toBe(false);
  });

  it("reports per-stage requirements honestly on a fresh session", () => {
    const workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(freshSession()),
    );
    const keys = workflow.stages[0].requirements.map((requirement) => requirement.key);
    expect(keys).toEqual(["prepare", "trials", "report", "concordance"]);
    expect(workflow.stages[0].requirements.every((requirement) => !requirement.done)).toBe(true);
  });

  it("marks preparation done after setup, weighing and indicator", () => {
    const session = freshSession();
    setup(session);
    prepareStageA(session);
    const workflow = projectExperimentWorkflow(exp02TitrationConfig, toPublicJSON(session));
    const [prepare, trials] = workflow.stages[0].requirements;
    expect(prepare.done).toBe(true);
    expect(trials.done).toBe(false);
  });

  it("blocks submission while a recorded trial is unreported", () => {
    const session = concordantFullSession();
    // Simulate a trial recorded but never reported: clear the per-trial value
    // and drop one entry from the aggregate the concordance was built from.
    const stage = session.public.stages[STAGE_B];
    const trial = stage.trials.find((t) => t.trialNumber === 1)!;
    trial.reportedMolarityM = null;
    stage.reportedMolaritiesM.splice(0, 1);
    const workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(session),
      [],
    );
    expect(workflow.blockers.some((blocker) => blocker.includes("trial 1"))).toBe(true);
    expect(workflow.canSubmit).toBe(false);
  });

  it("blocks submission while a required observation is missing", () => {
    const workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(concordantFullSession()),
      REQUIRED_OBSERVATION,
    );

    expect(workflow.allStagesComplete).toBe(true);
    expect(workflow.missingObservations).toEqual(REQUIRED_OBSERVATION);
    expect(workflow.canSubmit).toBe(false);
    expect(workflow.blockers.some((blocker) => blocker.includes("colour change"))).toBe(true);
  });

  it("allows submission when every stage is concordant, reported and observed", () => {
    const session = concordantFullSession();
    expect(
      recordObservation(session, STAGE_A, "colour_change", "Colourless to a faint pink that persists.").ok,
    ).toBe(true);
    const workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(session),
      REQUIRED_OBSERVATION,
    );

    expect(workflow.allStagesComplete).toBe(true);
    expect(workflow.blockers).toEqual([]);
    expect(workflow.canSubmit).toBe(true);
    expect(workflow.activeStageKey).toBe(STAGE_B);
  });
});
