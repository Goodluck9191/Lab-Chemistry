import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  createTitrationSession,
  projectPublicState,
  recordObservation,
  toPublicJSON,
} from "@/domain/simulation/titration/engine";
import {
  addIndicator,
  addTitrant,
  completeTrial,
  observeEndpoint,
  readBurette,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import { evaluateMolarityConcordance, averageTwoClosest } from "@/domain/simulation/titration/trials";
import { titrationPublicStateSchema } from "@/domain/simulation/titration/schema";
import {
  DEFAULT_SEED,
  STAGE_A,
  concordantStageASession,
  freshSession,
  hiddenTruth,
  overshotStageASession,
  prepareStageA,
  round2,
  runTrial,
  setup,
} from "../helpers/titration-fixtures";

describe("titration public state (phase 4 additions)", () => {
  it("derives the flask colour from the configuration, not from a component", () => {
    const session = freshSession();
    expect(toPublicJSON(session).stages[STAGE_A].flaskColour).toBeNull();

    setup(session);
    expect(toPublicJSON(session).stages[STAGE_A].flaskColour).toBeNull();

    weighAnalyte(session, STAGE_A, 0.6);
    expect(toPublicJSON(session).stages[STAGE_A].flaskColour).toBeNull();

    // The indicator's configured acid colour is what appears in the flask.
    addIndicator(session, STAGE_A, 3);
    expect(toPublicJSON(session).stages[STAGE_A].flaskColour).toBe("colourless");

    startTrialAction(session, STAGE_A, 1, 0);
    const observable = hiddenTruth(session, STAGE_A).observableMl;
    addTitrant(session, STAGE_A, observable);
    expect(toPublicJSON(session).stages[STAGE_A].flaskColour).toBe("faint_pink");

    // A large delivery past the endpoint shows the overshoot colour.
    addTitrant(session, STAGE_A, 2);
    expect(toPublicJSON(session).stages[STAGE_A].flaskColour).toBe("deep_pink");
  });

  it("records the observed colour on the trial when it is closed", () => {
    const session = overshotStageASession();
    const stage = toPublicJSON(session).stages[STAGE_A];
    expect(stage.trials).toHaveLength(1);
    expect(stage.trials[0].status).toBe("discarded_overshoot");
    expect(stage.trials[0].observedColour).toBe("deep_pink");
    expect(stage.trials[0].endpointJudgement).toBe("overshot");
  });

  it("keeps the delivered running total accurate so the bench can draw the column", () => {
    const session = freshSession();
    setup(session);
    prepareStageA(session);
    startTrialAction(session, STAGE_A, 1, 0.5);
    expect(toPublicJSON(session).stages[STAGE_A].deliveredSoFarMl).toBe(0);

    addTitrant(session, STAGE_A, 1);
    addTitrant(session, STAGE_A, 0.25);
    expect(toPublicJSON(session).stages[STAGE_A].deliveredSoFarMl).toBe(1.25);

    readBurette(session, STAGE_A, 1.75);
    completeTrial(session, STAGE_A);
    // The burette still reads where the trial stopped.
    expect(toPublicJSON(session).stages[STAGE_A].deliveredSoFarMl).toBe(1.25);

    prepareStageA(session);
    startTrialAction(session, STAGE_A, 2, 0);
    expect(toPublicJSON(session).stages[STAGE_A].deliveredSoFarMl).toBe(0);
  });

  it("derives concordance with the same domain functions assessment uses", () => {
    const session = concordantStageASession();
    const stage = toPublicJSON(session).stages[STAGE_A];
    const expected = evaluateMolarityConcordance(stage.reportedMolaritiesM, 0.005);

    expect(stage.concordance.mode).toBe("molarity");
    expect(stage.concordance.requiredTrials).toBe(3);
    expect(stage.concordance.maxTrials).toBe(4);
    expect(stage.concordance.recordedTrials).toBe(3);
    expect(stage.concordance.trialsStillNeeded).toBe(0);
    expect(stage.concordance.concordant).toBe(true);
    expect(stage.concordance.spread).toBe(expected.spread);
    expect(stage.concordance.allowedSpread).toBe(0.005);
    expect(stage.concordance.spreadUnit).toBe("mol/L");
    expect(stage.concordance.averageMolarityM).toBe(
      averageTwoClosest(stage.reportedMolaritiesM),
    );
  });

  it("requires enough evidence before calling a spread concordant", () => {
    const session = freshSession();
    setup(session);
    prepareStageA(session);
    const observable = hiddenTruth(session, STAGE_A).observableMl;
    runTrial(session, { trialNumber: 1, deliveredMl: observable });
    reportMolarity(session, STAGE_A, 1, 0.1);

    const stage = toPublicJSON(session).stages[STAGE_A];
    expect(stage.concordance.reportedMolaritiesM).toHaveLength(1);
    expect(stage.concordance.concordant).toBe(false);
    expect(stage.concordance.trialsStillNeeded).toBe(2);
    expect(stage.concordance.spread).toBeNull();
  });

  it("lists rejected trials separately from recorded ones", () => {
    const session = overshotStageASession();
    const stage = toPublicJSON(session).stages[STAGE_A];
    expect(stage.concordance.recordedTrials).toBe(0);
    expect(stage.concordance.discardedTrials).toEqual([1]);
    expect(stage.concordance.reportedMolaritiesM).toEqual([]);
  });

  it("stores and replaces student observations, rejecting unusable text", () => {
    const session = freshSession();

    expect(recordObservation(session, STAGE_A, "colour_change", "  Faint pink  ").ok).toBe(true);
    expect(toPublicJSON(session).observations).toEqual([
      { stageKey: STAGE_A, fieldKey: "colour_change", textValue: "Faint pink" },
    ]);

    // A second write replaces the first: observations are correctable.
    expect(recordObservation(session, STAGE_A, "colour_change", "Pale pink that persisted").ok).toBe(
      true,
    );
    expect(toPublicJSON(session).observations).toHaveLength(1);
    expect(toPublicJSON(session).observations[0].textValue).toBe("Pale pink that persisted");

    // A different stage keeps its own text.
    expect(recordObservation(session, "stage-b-hcl-naoh", "colour_change", "Pink").ok).toBe(true);
    expect(toPublicJSON(session).observations).toHaveLength(2);

    expect(recordObservation(session, STAGE_A, "colour_change", "   ").ok).toBe(false);
    expect(recordObservation(session, STAGE_A, "Bad Key", "text").ok).toBe(false);
    expect(recordObservation(session, STAGE_A, "x", "text").ok).toBe(false);
    expect(recordObservation(session, STAGE_A, "colour_change", "a".repeat(2001)).ok).toBe(false);
    expect(() => recordObservation(session, "no-such-stage", "colour_change", "text")).toThrow();
  });

  it("projects a document that validates against the strict public schema", () => {
    const session = concordantStageASession();
    const projected = projectPublicState(session);
    expect(() => titrationPublicStateSchema.parse(projected)).not.toThrow();
    // Round-tripping the projection is stable: derivations are recomputed, not drifted.
    expect(JSON.stringify(projectPublicState(session))).toBe(JSON.stringify(projected));
    // The projection is a copy: mutating it cannot corrupt the session.
    projected.stages[STAGE_A].trials.push({} as never);
    expect(toPublicJSON(session).stages[STAGE_A].trials).toHaveLength(3);
  });

  it("never leaks the hidden endpoint through an overshoot error event", () => {
    const session = overshotStageASession();
    const truth = hiddenTruth(session, STAGE_A);
    const serialised = JSON.stringify(toPublicJSON(session));

    // Regression: this string used to contain "vs observable 24.xx mL".
    expect(serialised).not.toContain(truth.observableMl.toFixed(2));
    expect(serialised).not.toContain(truth.equivalenceMl.toFixed(2));
    expect(serialised).not.toContain(truth.equivalenceMl.toString());
    expect(serialised).not.toContain(truth.trueTitrantMolarityM.toString());

    const overshoot = toPublicJSON(session).errorEvents.find((event) => event.code === "over_titration");
    expect(overshoot).toBeDefined();
    expect(overshoot?.detail).not.toMatch(/\d/);
  });

  it("confirms the observed colour against the hidden truth without revealing it", () => {
    const session = freshSession();
    setup(session);
    prepareStageA(session);
    startTrialAction(session, STAGE_A, 1, 0);
    const observable = hiddenTruth(session, STAGE_A).observableMl;
    addTitrant(session, STAGE_A, round2(observable - 0.2));

    const result = observeEndpoint(session, STAGE_A, "pink");
    expect(result.ok).toBe(true);
    // The student's claim disagreed, so a flag is recorded — but the flag names
    // only the colours, never a volume.
    const flag = toPublicJSON(session).errorEvents.find((event) => event.code === "reading_error");
    expect(flag?.detail).toBe("claimed pink but flask shows colourless");
  });

  it("keeps both configured stages resumable and independent", () => {
    const session = createTitrationSession(exp02TitrationConfig, DEFAULT_SEED);
    setupApparatus(session, "stage-b-hcl-naoh", "naoh", 0);
    expect(toPublicJSON(session).stages["stage-b-hcl-naoh"].apparatusReady).toBe(true);
    expect(toPublicJSON(session).stages[STAGE_A].apparatusReady).toBe(false);
    expect(Object.keys(toPublicJSON(session).stages)).toEqual([
      "stage-a-khp-naoh",
      "stage-b-hcl-naoh",
    ]);
  });
});
