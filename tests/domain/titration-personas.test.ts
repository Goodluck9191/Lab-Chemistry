import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  addIndicator,
  addTitrant,
  completeTrial,
  createTitrationSession,
  gradeSession,
  readBurette,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  weighAnalyte,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";

const STAGE_A = "stage-a-khp-naoh";

function setupStageA(session: TitrationSession, seed: string): void {
  void seed;
  setupApparatus(session, STAGE_A, "naoh", 0);
  weighAnalyte(session, STAGE_A, 0.6);
  addIndicator(session, STAGE_A, 3);
}

/** Deliver exactly `deliveredMl` then read and complete the trial. */
function runTrial(session: TitrationSession, n: number, deliveredMl: number): void {
  startTrialAction(session, STAGE_A, n, 0);
  let remaining = deliveredMl;
  while (remaining > 0) {
    const step = Math.min(1, Math.round(remaining * 100) / 100);
    addTitrant(session, STAGE_A, step);
    remaining = Math.round((remaining - step) * 100) / 100;
  }
  readBurette(session, STAGE_A, deliveredMl);
  completeTrial(session, STAGE_A);
}

function reportFromDelivered(session: TitrationSession, n: number, deliveredMl: number): void {
  const expected = 0.6 / 204.2223 / (deliveredMl / 1000);
  reportMolarity(session, STAGE_A, n, expected);
}

describe("personas", () => {
  it("perfect student: three correct trials, concordant, high score", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-perfect");
    setupStageA(session, "persona-perfect");
    const target = session.hidden.stages[STAGE_A].observableMl;
    for (let n = 1; n <= 3; n += 1) {
      runTrial(session, n, target);
      reportFromDelivered(session, n, target);
    }
    const grade = gradeSession(session, STAGE_A);
    expect(grade.concordant).toBe(true);
    expect(grade.total).toBeGreaterThanOrEqual(90);
  });

  it("poor meniscus reader: systematic +0.15 mL reading error has consequences", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-meniscus");
    setupStageA(session, "persona-meniscus");
    const target = session.hidden.stages[STAGE_A].observableMl;
    for (let n = 1; n <= 3; n += 1) {
      startTrialAction(session, STAGE_A, n, 0);
      addTitrant(session, STAGE_A, target);
      // Reads 0.15 mL high every time: recorded titre exceeds delivery.
      readBurette(session, STAGE_A, target + 0.15);
      completeTrial(session, STAGE_A);
      const trial = session.public.stages[STAGE_A].trials[n - 1];
      reportMolarity(session, STAGE_A, n, 0.6 / 204.2223 / ((trial.deliveredMl ?? 1) / 1000));
    }
    // Error events recorded the misreading; molarity still computable.
    expect(
      session.public.errorEvents.some((e) => e.code === "reading_error"),
    ).toBe(true);
    const grade = gradeSession(session, STAGE_A);
    expect(grade.total).toBeLessThan(100);
  });

  it("over-titrator: blows past the endpoint, trial discarded", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-over");
    setupStageA(session, "persona-over");
    runTrial(session, 1, 40);
    const trial = session.public.stages[STAGE_A].trials[0];
    expect(trial.status).toBe("discarded_overshoot");
    expect(
      session.public.errorEvents.some((e) => e.code === "over_titration"),
    ).toBe(true);
    const grade = gradeSession(session, STAGE_A);
    expect(grade.total).toBeLessThan(90);
  });

  it("non-concordant student: scattered titres must repeat", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-scatter");
    setupStageA(session, "persona-scatter");
    const targets = [12.0, 14.5, 17.0];
    targets.forEach((t, i) => {
      runTrial(session, i + 1, t);
      reportFromDelivered(session, i + 1, t);
    });
    const grade = gradeSession(session, STAGE_A);
    expect(grade.concordant).toBe(false);
    expect(grade.lines.find((l) => l.key === "concordance")?.awarded).toBe(0);
  });

  it("wrong reagent: HCl in the burette is rejected and logged", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-reagent");
    const result = setupApparatus(session, STAGE_A, "hcl", 0);
    expect(result.ok).toBe(false);
    expect(
      session.public.errorEvents.some((e) => e.code === "wrong_reagent"),
    ).toBe(true);
  });

  it("wrong sequence: indicator before analyte is rejected", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-sequence");
    setupApparatus(session, STAGE_A, "naoh", 0);
    const result = addIndicator(session, STAGE_A, 3);
    expect(result.ok).toBe(false);
    expect(
      session.public.errorEvents.some((e) => e.code === "invalid_sequence"),
    ).toBe(true);
  });

  it("cheating attempt: no action can set the score or the hidden truth", () => {
    const session = createTitrationSession(exp02TitrationConfig, "persona-cheat");
    setupStageA(session, "persona-cheat");
    const target = session.hidden.stages[STAGE_A].observableMl;
    runTrial(session, 1, target);
    // There is simply no API to assign these; assert the surface instead.
    const api = Object.keys(session.public);
    expect(api).not.toContain("seed");
    expect(api).not.toContain("hidden");
    const gradeBefore = gradeSession(session, STAGE_A).total;
    // Tampering with the public snapshot cannot inflate the grade because
    // grading consults server-side hidden state.
    (session.public as { completedTrials: number }).completedTrials = 999;
    const gradeAfter = gradeSession(session, STAGE_A).total;
    expect(gradeAfter).toBe(gradeBefore);
  });
});
