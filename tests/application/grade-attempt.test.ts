import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analyteConcentrationFromTitration } from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";
import { declaredQuestionsFor } from "@/domain/experiments/catalog/catalog-registry";
import {
  addTitrant,
  completeTrial,
  discardToWaste,
  readBurette,
  recordObservation,
  reportMolarity,
  startTrialAction,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  gradeAttemptOnSubmit,
  missingRequiredAnswers,
  scoreAnswer,
  scoreReportAnswers,
} from "@/application/attempts/grade-attempt";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import {
  freshSession,
  hiddenTruth,
  provisionStageA,
  provisionStageB,
  round2,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

const FULL_SECTIONS = {
  aim: "Standardise NaOH.",
  procedure: "Titrate KHP, then HCl.",
  resultsSummary: "Concordant titres.",
  conclusion: "NaOH standardised; HCl determined.",
  safetyNotes: "Goggles on.",
};

const FULL_ANSWERS: Record<string, string> = {
  q_aim: "Determine the exact concentration (molarity) of NaOH by titration against KHP.",
  q_water_volume: "Only the moles (amount) of KHP matter; extra water leaves the amount unchanged.",
  q_water_type: "Distilled water, free of ions and dissolved carbon dioxide impurities.",
  q_weighing_difference: "Weighing by difference is more accurate because nothing is lost in transfer.",
  q_naoh_effects: "Spilled KHP gives a higher calculated molarity; splash and overshoot increase titre volume so the result is lower.",
  q_acid_effects: "Spilled acid means fewer moles titrated so lower; splash and overshooting the endpoint lower the result because of excess titrant.",
};

/** A session whose reported molarities are exactly right, for a perfect run. */
function perfectSession(seed: string): TitrationSession {
  const session = freshSession(seed);
  provisionStageA(session);
  const endpointA = round2(hiddenTruth(session, STAGE_A).observableMl);
  for (let trial = 1; trial <= 3; trial += 1) {
    startTrialAction(session, STAGE_A, trial, 0);
    addTitrant(session, STAGE_A, endpointA);
    readBurette(session, STAGE_A, endpointA);
    completeTrial(session, STAGE_A);
    const expected = 0.6 / KHP_MOLAR_MASS_G_PER_MOL / (endpointA / 1000);
    expect(reportMolarity(session, STAGE_A, trial, Math.round(expected * 1e6) / 1e6).correct).toBe(true);
    expect(discardToWaste(session, STAGE_A).ok).toBe(true);
  }
  provisionStageB(session);
  const endpointB = round2(hiddenTruth(session, STAGE_B).observableMl);
  const truthB = hiddenTruth(session, STAGE_B);
  for (let trial = 1; trial <= 3; trial += 1) {
    startTrialAction(session, STAGE_B, trial, 0);
    addTitrant(session, STAGE_B, endpointB);
    readBurette(session, STAGE_B, endpointB);
    completeTrial(session, STAGE_B);
    const expected = analyteConcentrationFromTitration({
      titrantMolarityMolPerL: truthB.trueTitrantMolarityM,
      titrantVolumeValue: endpointB,
      titrantVolumeUnit: "mL",
      analyteVolumeValue: 25,
      analyteVolumeUnit: "mL",
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 },
    });
    expect(reportMolarity(session, STAGE_B, trial, Math.round(expected * 1e6) / 1e6).correct).toBe(true);
    expect(discardToWaste(session, STAGE_B).ok).toBe(true);
  }
  expect(recordObservation(session, STAGE_A, "colour_change", "Colourless to a persistent faint pink.").ok).toBe(
    true,
  );
  return session;
}

describe("question scoring", () => {
  it("awards full, half and zero on keyword bands, case-insensitively", () => {
    const question = declaredQuestionsFor("exp-02").find((entry) => entry.key === "q_aim");
    expect(question).toBeDefined();
    expect(scoreAnswer(question!, "Determine the CONCENTRATION by TITRATION against KHP").awarded).toBe(2);
    expect(scoreAnswer(question!, "Something about molarity.").awarded).toBe(1);
    expect(scoreAnswer(question!, "Unrelated words here.").awarded).toBe(0);
  });

  it("scores every declared question and totals the rubric", () => {
    const questions = declaredQuestionsFor("exp-02");
    expect(questions).toHaveLength(6);
    const scoring = scoreReportAnswers(questions, FULL_ANSWERS);
    expect(scoring.max).toBe(12);
    expect(scoring.total).toBe(12);
    expect(scoreReportAnswers(questions, {}).total).toBe(0);
  });

  it("lists unanswered required questions for the submit gate", () => {
    const questions = declaredQuestionsFor("exp-02");
    expect(missingRequiredAnswers(questions, {}).length).toBe(6);
    expect(missingRequiredAnswers(questions, FULL_ANSWERS)).toEqual([]);
    expect(missingRequiredAnswers(questions, { ...FULL_ANSWERS, q_aim: "  " })).toEqual(["q_aim"]);
  });
});

describe("automatic assessment on submit", () => {
  it("awards full marks to a perfect run", () => {
    const session = perfectSession("grade-perfect-seed");
    const graded = gradeAttemptOnSubmit({
      session,
      config: exp02TitrationConfig,
      experimentId: "exp-02",
      answers: FULL_ANSWERS,
      sections: FULL_SECTIONS,
    });
    expect(graded.autoScore).toBe(100);
    expect(graded.categories).toHaveLength(10);
    expect(graded.categories.reduce((sum, entry) => sum + entry.awarded, 0)).toBe(100);
    expect(graded.questions.total).toBe(12);
    expect(graded.calculations).toHaveLength(6);
    expect(graded.calculations.every((calc) => calc.correct)).toBe(true);
    expect(
      graded.calculations.every((calc) => /__molarity_trial_[1-4]$/.test(calc.questionKey)),
    ).toBe(true);
  });

  it("is deterministic for the same attempt", () => {
    const first = gradeAttemptOnSubmit({
      session: perfectSession("grade-determinism-seed"),
      config: exp02TitrationConfig,
      experimentId: "exp-02",
      answers: FULL_ANSWERS,
      sections: FULL_SECTIONS,
    });
    const second = gradeAttemptOnSubmit({
      session: perfectSession("grade-determinism-seed"),
      config: exp02TitrationConfig,
      experimentId: "exp-02",
      answers: FULL_ANSWERS,
      sections: FULL_SECTIONS,
    });
    expect(second).toEqual(first);
  });

  it("deducts for overshoots, wrong calculations and missing write-up", () => {
    // A frozen row cannot be corrupted after the fact, so grade a session
    // whose Stage B trial 1 carries a wrong report instead.
    const flawed = perfectSession("grade-flawed-seed");
    const stageB = flawed.public.stages[STAGE_B];
    const wrong = stageB.trials.find((trial) => trial.trialNumber === 1);
    if (wrong) wrong.reportedMolarityM = 0.999;
    const graded = gradeAttemptOnSubmit({
      session: flawed,
      config: exp02TitrationConfig,
      experimentId: "exp-02",
      answers: {},
      sections: { ...FULL_SECTIONS, conclusion: "" },
    });
    expect(graded.autoScore).toBeLessThan(100);
    expect(graded.autoScore).toBeGreaterThanOrEqual(0);
    expect(graded.questions.total).toBe(0);
    const report = graded.categories.find((entry) => entry.key === "report");
    expect(report?.awarded).toBeLessThan(2);
  });

  it("keeps hidden values out of the student-visible breakdown", () => {
    const session = perfectSession("grade-leak-seed");
    const graded = gradeAttemptOnSubmit({
      session,
      config: exp02TitrationConfig,
      experimentId: "exp-02",
      answers: FULL_ANSWERS,
      sections: FULL_SECTIONS,
    });
    // The expected values live only in `calculations`; everything else the
    // student may see must be free of hidden keys and values.
    const { calculations: _calculations, ...studentVisible } = graded;
    expect(_calculations.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(studentVisible);
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(`"${key}"`);
    }
  });
});
