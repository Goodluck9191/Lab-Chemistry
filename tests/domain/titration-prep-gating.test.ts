import { describe, expect, it } from "vitest";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
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
  expect(outcome.accepted, `${action.type} should be accepted`).toBe(true);
  return outcome;
}

/**
 * The procedure gates: filling needs cleaning + conditioning, trial 1 needs
 * the full preparation chain, and later trials need waste disposal first.
 * Every refusal carries `preparation_incomplete` and names the missing step.
 */
describe("dispatch preparation gates", () => {
  it("refuses filling until Part I, the cleaning, the portion and the rinses are done", () => {
    const session = freshSession();
    const setup = {
      type: "setup_apparatus",
      stageKey: STAGE_A,
      titrantKey: "naoh",
      initialReadingMl: 0,
    } as const;

    // Part I comes first: there is no titrant to fill the burette with yet.
    let outcome = dispatchTitrationAction(session, EXPERIMENT_ID, { ...setup });
    expect(outcome).toMatchObject({ accepted: false, code: "preparation_incomplete" });
    expect(outcome.message).toMatch(/measure the .* stock solution/i);

    apply(session, { type: "measure_naoh_stock", stageKey: STAGE_A, observedVolumeMl: 10 });
    apply(session, { type: "dilute_naoh_solution", stageKey: STAGE_A });
    apply(session, { type: "mix_naoh_solution", stageKey: STAGE_A });

    outcome = dispatchTitrationAction(session, EXPERIMENT_ID, { ...setup });
    expect(outcome.message).toMatch(/clean the burette/i);

    apply(session, { type: "rinse_burette", stageKey: STAGE_A });
    // The conditioning rinses are the titrant, so the portion has to exist.
    outcome = dispatchTitrationAction(session, EXPERIMENT_ID, { ...setup });
    expect(outcome.message).toMatch(/portion of the working solution/i);

    apply(session, { type: "obtain_naoh_portion", stageKey: STAGE_A });
    outcome = dispatchTitrationAction(session, EXPERIMENT_ID, { ...setup });
    expect(outcome.message).toMatch(/condition.*0 of 3/i);

    apply(session, { type: "condition_burette", stageKey: STAGE_A });
    apply(session, { type: "condition_burette", stageKey: STAGE_A });
    outcome = dispatchTitrationAction(session, EXPERIMENT_ID, { ...setup });
    expect(outcome.message).toMatch(/condition.*2 of 3/i);

    apply(session, { type: "condition_burette", stageKey: STAGE_A });
    expect(
      dispatchTitrationAction(session, EXPERIMENT_ID, { ...setup }).accepted,
    ).toBe(true);
  });

  it("refuses trial 1 until the preparation chain is complete, naming each gap", () => {
    const session = freshSession();
    const start = {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 1,
      initialReadingMl: 0,
    } as const;
    const attempt = () => dispatchTitrationAction(session, EXPERIMENT_ID, { ...start });

    // Procedure order, one gap named at a time: Part I, then the burette, then
    // the sample.
    expect(attempt().message).toMatch(/measure the .* stock solution/i);
    apply(session, { type: "measure_naoh_stock", stageKey: STAGE_A, observedVolumeMl: 10 });
    expect(attempt().message).toMatch(/distilled water/i);
    apply(session, { type: "dilute_naoh_solution", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/swirl to mix the working solution/i);
    apply(session, { type: "mix_naoh_solution", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/clean the burette/i);
    apply(session, { type: "rinse_burette", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/portion of the working solution/i);
    apply(session, { type: "obtain_naoh_portion", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/condition the burette/i);
    apply(session, { type: "condition_burette", stageKey: STAGE_A });
    apply(session, { type: "condition_burette", stageKey: STAGE_A });
    apply(session, { type: "condition_burette", stageKey: STAGE_A });
    apply(session, {
      type: "setup_apparatus",
      stageKey: STAGE_A,
      titrantKey: "naoh",
      initialReadingMl: 0,
    });
    expect(attempt().message).toMatch(/empty beaker/i);
    apply(session, { type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.34 });
    apply(session, { type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.94 });
    expect(attempt().message).toMatch(/air bubble/i);
    apply(session, { type: "clear_air_bubble", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/dissolve/i);
    apply(session, { type: "dissolve_khp", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/transfer/i);
    apply(session, { type: "transfer_solution", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/rinse the beaker/i);
    apply(session, { type: "rinse_beaker", stageKey: STAGE_A });
    apply(session, { type: "rinse_beaker", stageKey: STAGE_A });
    expect(attempt().message).toMatch(/indicator/i);
    apply(session, { type: "add_indicator", stageKey: STAGE_A, drops: 3 });
    expect(attempt().message).toMatch(/place the flask/i);
    apply(session, { type: "place_flask", stageKey: STAGE_A });
    expect(attempt().accepted).toBe(true);
  });

  it("leaves the full preparation state behind once provisioned", () => {
    const session = freshSession();
    provisionStageA(session);
    expect(session.public.solution).toMatchObject({ diluted: true, mixed: true });
    const prep = session.public.stages[STAGE_A].preparation;
    expect(prep.buretteCleaned).toBe(true);
    expect(prep.beakerObtained).toBe(true);
    expect(prep.conditioningRinses).toBe(3);
    expect(prep.airBubbleCleared).toBe(true);
    expect(prep.beakerMassG).toBe(52.34);
    expect(prep.beakerPlusKhpMassG).toBe(52.94);
    expect(session.public.stages[STAGE_A].analyteMassG).toBe(0.6);
    expect(prep.khpDissolved).toBe(true);
    expect(prep.khpTransferred).toBe(true);
    expect(prep.beakerRinses).toBe(2);
    expect(prep.flaskPlaced).toBe(true);
  });

  it("requires waste disposal between trials", () => {
    const session = freshSession();
    provisionStageA(session);
    const endpoint = round2(hiddenTruth(session, STAGE_A).observableMl);
    const trial = (trialNumber: number) => {
      apply(session, { type: "start_trial", stageKey: STAGE_A, trialNumber, initialReadingMl: 0 });
      apply(session, { type: "add_titrant", stageKey: STAGE_A, volumeMl: endpoint });
      apply(session, { type: "read_burette", stageKey: STAGE_A, observedFinalMl: endpoint });
      apply(session, { type: "complete_trial", stageKey: STAGE_A });
    };
    trial(1);

    const blocked = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 2,
      initialReadingMl: 0,
    });
    expect(blocked).toMatchObject({ accepted: false, code: "preparation_incomplete" });
    expect(blocked.message).toMatch(/discard.*waste/i);

    apply(session, { type: "discard_to_waste", stageKey: STAGE_A });
    expect(
      dispatchTitrationAction(session, EXPERIMENT_ID, {
        type: "start_trial",
        stageKey: STAGE_A,
        trialNumber: 2,
        initialReadingMl: 0,
      }).accepted,
    ).toBe(true);
  });

  it("leaks nothing hidden in preparation refusals", () => {
    const session = freshSession("prep-gating-leak-seed");
    const serialised = JSON.stringify([
      dispatchTitrationAction(session, EXPERIMENT_ID, {
        type: "setup_apparatus",
        stageKey: STAGE_A,
        titrantKey: "naoh",
        initialReadingMl: 0,
      }),
      dispatchTitrationAction(session, EXPERIMENT_ID, {
        type: "start_trial",
        stageKey: STAGE_A,
        trialNumber: 1,
        initialReadingMl: 0,
      }),
      dispatchTitrationAction(session, EXPERIMENT_ID, {
        type: "weigh_beaker",
        stageKey: STAGE_A,
        observedMassG: 1,
      }),
    ]);
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    expect(serialised).not.toContain("prep-gating-leak-seed");
  });
});
