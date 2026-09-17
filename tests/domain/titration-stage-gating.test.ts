import { describe, expect, it } from "vitest";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import {
  concordantStageASession,
  freshSession,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

const EXPERIMENT_ID = "exp-02";

describe("dispatch stage ordering", () => {
  it("rejects work on Stage B while Stage A is still incomplete", () => {
    const session = freshSession();

    const setup = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "setup_apparatus",
      stageKey: STAGE_B,
      titrantKey: "naoh",
      initialReadingMl: 0,
    });

    expect(setup.accepted).toBe(false);
    expect(setup.code).toBe("stage_locked");
    expect(setup.message).toContain("locked");
    expect(setup.message).toContain("Stage A");
    expect(setup.colour).toBeNull();
    expect(setup.calculationCorrect).toBeNull();
    // Nothing was written: the locked stage is untouched.
    expect(session.public.stages[STAGE_B].apparatusReady).toBe(false);
  });

  it("rejects every action kind on a locked stage, including observations", () => {
    const lockedActions = [
      { type: "weigh_analyte", stageKey: STAGE_B, observedMassG: 0.6 },
      { type: "start_trial", stageKey: STAGE_B, trialNumber: 1, initialReadingMl: 0 },
      {
        type: "record_observation",
        stageKey: STAGE_B,
        fieldKey: "colour_change",
        text: "Pink.",
      },
    ] as const;

    for (const action of lockedActions) {
      const outcome = dispatchTitrationAction(freshSession(), EXPERIMENT_ID, action);
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("stage_locked");
    }
  });

  it("still rejects unknown stages before checking the lock", () => {
    const outcome = dispatchTitrationAction(freshSession(), EXPERIMENT_ID, {
      type: "setup_apparatus",
      stageKey: "stage-does-not-exist",
      titrantKey: "naoh",
      initialReadingMl: 0,
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe("unknown_stage");
  });

  it("accepts Stage A work on a fresh session — the first stage is never locked", () => {
    const outcome = dispatchTitrationAction(freshSession(), EXPERIMENT_ID, {
      type: "setup_apparatus",
      stageKey: STAGE_A,
      titrantKey: "naoh",
      initialReadingMl: 0,
    });
    expect(outcome.accepted).toBe(true);
  });

  it("unlocks Stage B once Stage A is concordant", () => {
    const session = concordantStageASession();

    const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "setup_apparatus",
      stageKey: STAGE_B,
      titrantKey: "naoh",
      initialReadingMl: 0,
    });

    expect(outcome.accepted).toBe(true);
    expect(session.public.stages[STAGE_B].apparatusReady).toBe(true);
  });
});
