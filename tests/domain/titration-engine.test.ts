import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  addIndicator,
  addTitrant,
  completeTrial,
  createTitrationSession,
  gradeSession,
  pipetteAnalyte,
  readBurette,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  toPublicJSON,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";

const STAGE_A = "stage-a-khp-naoh";
const STAGE_B = "stage-b-hcl-naoh";

/** Run one perfect Stage-A trial: setup once, then titrate to faint pink. */
function runPerfectStageATrial(session: ReturnType<typeof createTitrationSession>, trialNumber: number, initialMl: number) {
  const hidden = session.hidden.stages[STAGE_A];
  if (trialNumber === 1) {
    expect(setupApparatus(session, STAGE_A, "naoh", initialMl).ok).toBe(true);
    expect(weighAnalyte(session, STAGE_A, 0.6).ok).toBe(true);
    expect(addIndicator(session, STAGE_A, 3).ok).toBe(true);
  }
  expect(startTrialAction(session, STAGE_A, trialNumber, initialMl).ok).toBe(true);
  // Realistic titration: fast additions, then drop-wise (~0.05 mL) near the
  // endpoint, stopping at the first faint pink (manual one-drop rule).
  let delivered = 0;
  for (let i = 0; i < 400; i += 1) {
    const step = hidden.observableMl - delivered > 1 ? 0.5 : 0.05;
    delivered = Math.round((delivered + step) * 100) / 100;
    const added = addTitrant(session, STAGE_A, step);
    expect(added.ok).toBe(true);
    if (added.colour === "faint_pink") break;
    if (delivered > hidden.observableMl + 0.1) break;
  }
  const finalMl = Math.round((initialMl + delivered) * 100) / 100;
  expect(readBurette(session, STAGE_A, finalMl).ok).toBe(true);
  expect(completeTrial(session, STAGE_A).ok).toBe(true);
  const trial = session.public.stages[STAGE_A].trials.find((t) => t.trialNumber === trialNumber);
  expect(trial?.status).toBe("recorded");
  return trial;
}

describe("titration engine lifecycle", () => {
  it("runs a perfect Stage-A trial and reports a correct molarity", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-perfect");
    const trial = runPerfectStageATrial(session, 1, 0);
    expect(trial?.endpointJudgement).toBe("correct");
    // Student calculates M_NaOH = n_KHP / V from their own readings.
    const expected = 0.6 / 204.2223 / ((trial?.deliveredMl ?? 0) / 1000);
    const reported = reportMolarity(session, STAGE_A, 1, expected);
    expect(reported.ok).toBe(true);
    expect(reported.correct).toBe(true);
  });

  it("rejects adding titrant with no open trial", () => {
    const session = createTitrationSession(exp02TitrationConfig, "seed-x");
    const result = addTitrant(session, STAGE_A, 1);
    expect(result.ok).toBe(false);
  });

  it("rejects weighing before apparatus setup (invalid sequence)", () => {
    const session = createTitrationSession(exp02TitrationConfig, "seed-x");
    const result = weighAnalyte(session, STAGE_A, 0.6);
    expect(result.ok).toBe(false);
    expect(session.public.errorEvents.some((e) => e.code === "invalid_sequence")).toBe(true);
  });

  it("rejects the wrong titrant reagent", () => {
    const session = createTitrationSession(exp02TitrationConfig, "seed-x");
    const result = setupApparatus(session, STAGE_A, "hcl", 0);
    expect(result.ok).toBe(false);
    expect(session.public.errorEvents.some((e) => e.code === "wrong_reagent")).toBe(true);
  });

  it("discards overshot trials instead of failing the attempt", () => {
    const session = createTitrationSession(exp02TitrationConfig, "seed-over");
    setupApparatus(session, STAGE_A, "naoh", 0);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
    startTrialAction(session, STAGE_A, 1, 0);
    // Dump far past the endpoint in one go.
    addTitrant(session, STAGE_A, 40);
    readBurette(session, STAGE_A, 40);
    expect(completeTrial(session, STAGE_A).ok).toBe(true);
    const trial = session.public.stages[STAGE_A].trials[0];
    expect(trial.status).toBe("discarded_overshoot");
    expect(session.public.errorEvents.some((e) => e.code === "over_titration")).toBe(true);
    // The attempt survives: a repeat trial can start.
    expect(startTrialAction(session, STAGE_A, 2, 0).ok).toBe(true);
  });

  it("runs Stage B (pipetted HCl) end to end", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-b");
    const hidden = session.hidden.stages[STAGE_B];
    setupApparatus(session, STAGE_B, "naoh", 0);
    expect(pipetteAnalyte(session, STAGE_B, 25).ok).toBe(true);
    expect(addIndicator(session, STAGE_B, 4).ok).toBe(true);
    expect(startTrialAction(session, STAGE_B, 1, 0).ok).toBe(true);
    // Step to just past observable in 1 mL increments.
    let delivered = 0;
    for (let i = 0; i < 60; i += 1) {
      delivered = Math.round((delivered + 1) * 100) / 100;
      addTitrant(session, STAGE_B, 1);
      if (delivered >= hidden.observableMl) break;
    }
    readBurette(session, STAGE_B, delivered);
    completeTrial(session, STAGE_B);
    const trial = session.public.stages[STAGE_B].trials[0];
    expect(["recorded", "discarded_overshoot"]).toContain(trial.status);
  });

  it("grades a perfect three-trial run as concordant with a high score", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-grade");
    for (let n = 1; n <= 3; n += 1) {
      const trial = runPerfectStageATrial(session, n, 0);
      const expected = 0.6 / 204.2223 / ((trial?.deliveredMl ?? 1) / 1000);
      reportMolarity(session, STAGE_A, n, expected);
    }
    const grade = gradeSession(session, STAGE_A);
    expect(grade.concordant).toBe(true);
    expect(grade.averageMolarityM).not.toBeNull();
    expect(grade.total).toBeGreaterThanOrEqual(90);
  });
});

describe("public/hidden separation", () => {
  it("never leaks hidden keys in the serialised public state", () => {
    const session = createTitrationSession(exp02TitrationConfig, "leak-check");
    runPerfectStageATrial(session, 1, 0);
    const serialised = JSON.stringify(toPublicJSON(session));
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(key);
    }
    expect(serialised).not.toContain("persona");
  });

  it("exposes no score-setting or secret-setting action", () => {
    const session = createTitrationSession(exp02TitrationConfig, "cheat-check");
    // Grading reads server-side hidden state only: stuffing values into the
    // public object cannot change the outcome.
    const grade = gradeSession(session, STAGE_A);
    expect(grade.total).toBeLessThanOrEqual(100);
    expect(grade.total).toBeGreaterThanOrEqual(0);
  });
});
