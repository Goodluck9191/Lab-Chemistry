import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analyteConcentrationFromTitration } from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";
import { experimentDefinitionFor } from "@/domain/experiments/catalog/catalog-registry";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { recordObservation, toPublicJSON } from "@/domain/simulation/titration/engine";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { buildReportModel } from "@/application/reports/report-model";
import {
  hiddenTruth,
  overshotStageASession,
  provisionedFullSession,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

const SECTIONS = {
  aim: "Standardise NaOH.",
  procedure: "Titrate KHP, then HCl.",
  resultsSummary: "Concordant titres.",
  conclusion: "NaOH standardised; HCl determined.",
  safetyNotes: "Goggles on.",
};

const ANSWERS: Record<string, unknown> = {
  q_aim: "Determine the exact concentration of NaOH by titration against KHP.",
  q_water_volume: "Only the moles of KHP matter; extra water leaves the amount unchanged.",
  q_water_type: "Distilled water, free of ions and carbon dioxide impurities.",
  q_weighing_difference: "Weighing by difference is accurate because nothing is lost in transfer.",
  q_naoh_effects: "Spilled KHP reads higher; splash and overshoot increase titre volume so lower.",
  q_acid_effects: "Spilled acid means fewer moles so lower; endpoint overshoot with excess titrant lowers it.",
};

function modelFor(seed: string, answers: Record<string, unknown> = ANSWERS) {
  const session = provisionedFullSession(seed);
  expect(recordObservation(session, STAGE_A, "colour_change", "Colourless to persistent faint pink.").ok).toBe(true);
  const definition = experimentDefinitionFor("exp-02");
  expect(definition).not.toBeNull();
  return {
    session,
    model: buildReportModel({
      definition: definition!,
      config: exp02TitrationConfig,
      publicState: toPublicJSON(session),
      report: { status: "draft", sections: SECTIONS, answers },
      grade: null,
      verdicts: [],
      feedback: [],
    }),
  };
}

describe("report model", () => {
  it("projects both stages with recorded trials and concordance", () => {
    const { model } = modelFor("report-model-seed");
    expect(model.stages).toHaveLength(2);
    for (const stage of model.stages) {
      expect(stage.trials.filter((trial) => trial.status === "recorded")).toHaveLength(3);
      expect(stage.concordant).toBe(true);
      expect(stage.averageMolarityM).not.toBeNull();
    }
    // Stage A reports carry the fixture constant; the average follows them.
    expect(model.stages[0].averageMolarityM).toBeCloseTo(0.1, 6);
    expect(model.standardizedNaohM).toBeCloseTo(0.1, 6);
    expect(model.finalHclM).toBeCloseTo(0.2, 6);
  });

  it("traces the KHP calculation from the student's own mass and titre", () => {
    const { session, model } = modelFor("report-khp-trace-seed");
    const stage = model.stages[0];
    expect(stage.khpMassG).toBeCloseTo(0.6, 6);
    const first = session.public.stages[STAGE_A].trials.find((trial) => trial.trialNumber === 1);
    expect(first?.deliveredMl).not.toBeNull();
    const expected = 0.6 / KHP_MOLAR_MASS_G_PER_MOL / ((first?.deliveredMl as number) / 1000);
    const trace = stage.calculations.find((calc) => calc.trialNumber === 1);
    expect(trace?.result).toBe(`${Math.round(expected * 1e6) / 1e6}`);
    expect(trace?.unit).toBe("mol/L");
  });

  it("traces the HCl calculation from the standardised average", () => {
    const { session, model } = modelFor("report-hcl-trace-seed");
    const stageB = session.public.stages[STAGE_B];
    const first = stageB.trials.find((trial) => trial.trialNumber === 1);
    const expected = analyteConcentrationFromTitration({
      titrantMolarityMolPerL: 0.1,
      titrantVolumeValue: first?.deliveredMl as number,
      titrantVolumeUnit: "mL",
      analyteVolumeValue: 25,
      analyteVolumeUnit: "mL",
      stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 },
    });
    const trace = model.stages[1].calculations.find((calc) => calc.trialNumber === 1);
    expect(trace?.result).toBe(`${Math.round(expected * 1e6) / 1e6}`);
    expect(model.stages[1].aliquotMl).toBe(25);
  });

  it("keeps rejected trials visible with their reason", () => {
    const session = overshotStageASession("report-overshoot-seed");
    const definition = experimentDefinitionFor("exp-02");
    const model = buildReportModel({
      definition: definition!,
      config: exp02TitrationConfig,
      publicState: toPublicJSON(session),
      report: { status: "draft", sections: SECTIONS, answers: ANSWERS },
      grade: null,
      verdicts: [],
      feedback: [],
    });
    const rejected = model.stages[0].trials.filter(
      (trial) => trial.status === "discarded_overshoot" || trial.status === "rejected",
    );
    expect(rejected.length).toBeGreaterThan(0);
    expect(model.stages[0].discardedTrials).toContain(rejected[0].trialNumber);
  });

  it("reports completion and names every missing item", () => {
    const { model } = modelFor("report-complete-seed");
    expect(model.missingItems).toEqual([]);
    expect(model.completionPercent).toBe(100);

    const incomplete = modelFor("report-incomplete-seed", {});
    expect(incomplete.model.missingItems.length).toBeGreaterThan(0);
    expect(incomplete.model.missingItems.some((item) => item.includes("Question"))).toBe(true);
    expect(incomplete.model.completionPercent).toBeLessThan(100);

    const definition = experimentDefinitionFor("exp-02");
    const missing = buildReportModel({
      definition: definition!,
      config: exp02TitrationConfig,
      publicState: toPublicJSON(provisionedFullSession("report-noconcl-state")),
      report: {
        status: "draft",
        sections: { ...SECTIONS, conclusion: "  " },
        answers: ANSWERS,
      },
      grade: null,
      verdicts: [],
      feedback: [],
    });
    expect(missing.missingItems.some((item) => item.includes("Conclusion"))).toBe(true);
  });

  it("scores questions and carries the write-up through", () => {
    const { model } = modelFor("report-questions-seed");
    expect(model.questions).toHaveLength(6);
    expect(model.questionsMax).toBe(12);
    expect(model.questionsTotal).toBeGreaterThan(0);
    expect(model.observations).toHaveLength(1);
    expect(model.observations[0].text).toContain("pink");
  });

  it("exposes no hidden values anywhere in the model", () => {
    const { model } = modelFor("report-leak-seed");
    const serialised = JSON.stringify(model);
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    const truth = hiddenTruth(provisionedFullSession("report-leak-truth"), STAGE_A);
    expect(serialised).not.toContain(truth.trueTitrantMolarityM.toString());
  });
});
