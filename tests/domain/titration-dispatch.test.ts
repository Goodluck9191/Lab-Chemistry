import { describe, expect, it } from "vitest";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import type { FlaskColour } from "@/domain/simulation/titration/endpoint";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import { read } from "../helpers/project-files";
import { freshSession, prepareStageA, setup, STAGE_A } from "../helpers/titration-fixtures";

/**
 * The router is the single mapping from a protocol action onto a domain
 * function. These tests pin its two responsibilities — the experiment-level
 * guards it owns, and the fact that it hands every action to the engine without
 * leaking a hidden value back.
 */

const EXPERIMENT_ID = "exp-02";

const FLASK_COLOURS: FlaskColour[] = ["colourless", "faint_pink", "pink", "deep_pink"];

function dispatch(action: TitrationProtocolAction, seed = "dispatch-fixture-seed") {
  const session = freshSession(seed);
  const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, action);
  return { session, outcome };
}

describe("titration action dispatch", () => {
  it("rejects a stage this attempt does not have as a protocol problem", () => {
    const session = freshSession();
    const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "setup_apparatus",
      stageKey: "stage-that-does-not-exist",
      titrantKey: "naoh",
      initialReadingMl: 0,
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe("unknown_stage");
    expect(outcome.message).toMatch(/no stage named/i);
  });

  it("routes setup through the engine and records the initial reading", () => {
    const { session, outcome } = dispatch({
      type: "setup_apparatus",
      stageKey: STAGE_A,
      titrantKey: "naoh",
      initialReadingMl: 0.4,
    });
    expect(outcome).toMatchObject({ accepted: true, code: null, message: null });
    expect(session.public.stages[STAGE_A].buretteInitialMl).toBe(0.4);
    expect(session.public.stages[STAGE_A].apparatusReady).toBe(true);
  });

  it("passes an engine refusal through with the engine's own code and wording", () => {
    const { session, outcome } = dispatch({
      type: "setup_apparatus",
      stageKey: STAGE_A,
      titrantKey: "hcl",
      initialReadingMl: 0,
    });
    expect(session.public.stages[STAGE_A].apparatusReady).toBe(false);
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe("wrong_reagent");
    expect(outcome.message).toMatch(/expected naoh/i);
  });

  it("refuses out-of-sequence actions with the engine's sequence code", () => {
    // Weighing before the burette exists.
    expect(
      dispatchTitrationAction(freshSession(), EXPERIMENT_ID, {
        type: "weigh_analyte",
        stageKey: STAGE_A,
        observedMassG: 0.6,
      }),
    ).toMatchObject({ accepted: false, code: "invalid_sequence" });

    // Indicator before the analyte is ready.
    const setupOnly = freshSession();
    setup(setupOnly);
    expect(
      dispatchTitrationAction(setupOnly, EXPERIMENT_ID, {
        type: "add_indicator",
        stageKey: STAGE_A,
        drops: 3,
      }),
    ).toMatchObject({ accepted: false, code: "invalid_sequence" });

    // Titrant with no open trial.
    const prepared = freshSession();
    setup(prepared);
    prepareStageA(prepared);
    expect(
      dispatchTitrationAction(prepared, EXPERIMENT_ID, {
        type: "add_titrant",
        stageKey: STAGE_A,
        volumeMl: 1,
      }),
    ).toMatchObject({ accepted: false, code: "invalid_sequence" });
  });

  it("returns the observed flask colour after a delivery", () => {
    const session = freshSession();
    setup(session);
    prepareStageA(session);
    dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 1,
      initialReadingMl: 0,
    });
    const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "add_titrant",
      stageKey: STAGE_A,
      volumeMl: 1,
    });
    expect(outcome.accepted).toBe(true);
    expect(FLASK_COLOURS).toContain(outcome.colour as FlaskColour);
    expect(session.public.stages[STAGE_A].deliveredSoFarMl).toBe(1);
  });

  it("carries correctness for a reported concentration but never the expected value", () => {
    const session = freshSession();
    setup(session);
    prepareStageA(session);
    dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 1,
      initialReadingMl: 0,
    });
    dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "add_titrant",
      stageKey: STAGE_A,
      volumeMl: 10,
    });
    dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "read_burette",
      stageKey: STAGE_A,
      observedFinalMl: 10,
    });
    dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "complete_trial",
      stageKey: STAGE_A,
    });

    const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "report_molarity",
      stageKey: STAGE_A,
      trialNumber: 1,
      studentMolarityM: 0.1,
    });
    expect(outcome.accepted).toBe(true);
    expect(typeof outcome.calculationCorrect).toBe("boolean");
    // The engine computes an expected value; the router must drop it.
    expect(Object.keys(outcome)).not.toContain("expected");
  });

  it("refuses an observation field the experiment does not declare", () => {
    const session = freshSession();
    setup(session);
    const undeclared = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "record_observation",
      stageKey: STAGE_A,
      fieldKey: "made_up_field",
      text: "something",
    });
    expect(undeclared).toMatchObject({ accepted: false, code: "undeclared_observation_field" });
    expect(session.public.observations).toHaveLength(0);

    // `colour_change` is the field exp-02 declares.
    const declared = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "record_observation",
      stageKey: STAGE_A,
      fieldKey: "colour_change",
      text: "The solution turned a faint pink that persisted.",
    });
    expect(declared.accepted).toBe(true);
    expect(session.public.observations).toHaveLength(1);
  });

  it("refuses a declared observation field for an experiment with no definition", () => {
    const session = freshSession();
    setup(session);
    expect(
      dispatchTitrationAction(session, "exp-does-not-exist", {
        type: "record_observation",
        stageKey: STAGE_A,
        fieldKey: "colour_change",
        text: "pink",
      }),
    ).toMatchObject({ accepted: false, code: "undeclared_observation_field" });
  });

  it("is the only protocol-to-engine mapping in the project", () => {
    // The autosaving server action must route through this module rather than
    // keeping a second switch that could drift from it.
    const source = read("application/attempts/apply-simulation-action.ts");
    expect(source).toContain("dispatchTitrationAction(");
    expect(source).not.toContain('case "add_titrant"');
    expect(source).not.toContain('case "report_molarity"');
  });
});
