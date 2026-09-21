import { describe, expect, it } from "vitest";
import {
  buildLabViewModel,
  chemicalLabel,
  flaskPinkOpacity,
} from "@/components/lab/view-model";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  addIndicator,
  addTitrant,
  clearAirBubble,
  conditionBurette,
  diluteWorkingSolution,
  dissolveKhp,
  measureStockVolume,
  mixWorkingSolution,
  obtainTitrantPortion,
  observeEndpoint,
  placeFlask,
  readBurette,
  reportMolarity,
  rinseBeaker,
  rinseBurette,
  startTrialAction,
  transferSolution,
  weighAnalyte,
  weighBeakerMass,
} from "@/domain/simulation/titration/engine";
import { toPublicJSON } from "@/domain/simulation/titration/engine";
import {
  STAGE_A,
  concordantStageASession,
  freshSession,
  hiddenTruth,
  overshotStageASession,
  provisionStageA,
  publicStateOf,
  runTrial,
  setup,
} from "../helpers/titration-fixtures";

const config = publicTitrationConfigView(exp02TitrationConfig);

function viewFor(
  session: Parameters<typeof publicStateOf>[0],
  options: { canWrite?: boolean; selectedStageKey?: string | null } = {},
) {
  return buildLabViewModel({
    config,
    publicState: publicStateOf(session),
    chemicalLabels: { khp: "Potassium hydrogen phthalate", naoh: "Sodium hydroxide solution" },
    apparatusLabels: { burette_50: "Burette, 50 mL" },
    selectedStageKey: options.selectedStageKey ?? null,
    canWrite: options.canWrite ?? true,
  });
}

describe("laboratory view model", () => {
  it("walks a fresh attempt through the Experiment 2 preparation procedure", () => {
    // Procedure order replaced the old setup-first guidance: Part I makes the
    // working titrant, then cleaning, the portion, conditioning and filling come
    // before weighing by difference, dissolution, transfer, rinses and
    // placement.
    const session = freshSession();
    const nextKind = () => viewFor(session).stages[0].nextAction?.kind;

    expect(nextKind()).toBe("measure_stock");
    expect(measureStockVolume(session, STAGE_A, 10).ok).toBe(true);
    expect(nextKind()).toBe("dilute_solution");
    expect(diluteWorkingSolution(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("mix_solution");
    expect(mixWorkingSolution(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("rinse_burette");
    expect(rinseBurette(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("obtain_naoh_portion");
    expect(obtainTitrantPortion(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("condition_burette");
    expect(conditionBurette(session, STAGE_A).ok).toBe(true);
    expect(conditionBurette(session, STAGE_A).ok).toBe(true);
    expect(conditionBurette(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("setup_apparatus");

    setup(session);
    expect(nextKind()).toBe("clear_air_bubble");
    expect(clearAirBubble(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("weigh_beaker");
    expect(weighBeakerMass(session, STAGE_A, 52.34).ok).toBe(true);
    expect(viewFor(session).stages[0].nextAction?.title).toContain("plus KHP");
    expect(weighBeakerMass(session, STAGE_A, 52.94).ok).toBe(true);
    expect(nextKind()).toBe("dissolve_khp");
    expect(dissolveKhp(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("transfer_solution");
    expect(transferSolution(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("rinse_beaker");
    expect(rinseBeaker(session, STAGE_A).ok).toBe(true);
    expect(rinseBeaker(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("add_indicator");

    addIndicator(session, STAGE_A, 3);
    expect(nextKind()).toBe("place_flask");
    expect(placeFlask(session, STAGE_A).ok).toBe(true);
    expect(nextKind()).toBe("start_trial");
  });

  it("moves through titrating, reading, completing and reporting", () => {
    const session = freshSession();
    provisionStageA(session);
    startTrialAction(session, STAGE_A, 1, 0);

    expect(viewFor(session).stages[0].nextAction?.kind).toBe("add_titrant");

    addTitrant(session, STAGE_A, 1);
    expect(viewFor(session).stages[0].nextAction?.kind).toBe("read_burette");

    readBurette(session, STAGE_A, 1);
    expect(viewFor(session).stages[0].nextAction?.kind).toBe("complete_trial");

    const observable = hiddenTruth(session, STAGE_A).observableMl;
    addTitrant(session, STAGE_A, observable - 1);
    readBurette(session, STAGE_A, observable);
    expect(viewFor(session).stages[0].nextAction?.kind).toBe("complete_trial");
  });

  it("asks for the concentration once a trial is recorded but unreported", () => {
    const session = freshSession();
    provisionStageA(session);
    runTrial(session, { trialNumber: 1, deliveredMl: hiddenTruth(session, STAGE_A).observableMl });

    const stage = viewFor(session).stages[0];
    expect(stage.nextAction?.kind).toBe("report_molarity");
    expect(stage.nextAction?.title).toContain("trial 1");
    expect(stage.nextTrialNumber).toBe(2);
  });

  it("describes the flask from the public colour only", () => {
    const session = freshSession();
    setup(session);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
    startTrialAction(session, STAGE_A, 1, 0);

    expect(viewFor(session).stages[0].flask.label).toBe("Colourless");
    // The flask now holds the dissolved sample plus indicator.
    expect(viewFor(session).stages[0].flask.hasContents).toBe(true);

    addTitrant(session, STAGE_A, hiddenTruth(session, STAGE_A).observableMl);
    const flask = viewFor(session).stages[0].flask;
    expect(flask.colour).toBe("faint_pink");
    expect(flask.label).toBe("Faint pink");
    expect(flask.tone).toBe("success");
    expect(flask.hasContents).toBe(true);
  });

  it("draws the burette level from the last saved delivery", () => {
    const session = freshSession();
    setup(session, STAGE_A, 0.5);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
    startTrialAction(session, STAGE_A, 1, 0.5);
    addTitrant(session, STAGE_A, 2);

    const stage = viewFor(session).stages[0];
    expect(stage.burette.readingMl).toBe(2.5);
    expect(stage.burette.fillFraction).toBeCloseTo(1 - 2.5 / 50, 5);
    expect(stage.burette.setup).toBe(true);
    // The stopcock is UI state and deliberately absent from the server-derived view.
    expect(stage.burette).not.toHaveProperty("stopcockOpen");
    expect(stage.deliveredMl).toBe(2);
  });

  it("shows no burette reading before the apparatus is set up", () => {
    const stage = viewFor(freshSession()).stages[0];
    expect(stage.burette.readingMl).toBeNull();
    expect(stage.burette.fillFraction).toBe(0);
    expect(stage.burette.setup).toBe(false);
  });

  it("tabulates persisted trials, including a rejected one", () => {
    const session = overshotStageASession();
    const stage = viewFor(session).stages[0];

    expect(stage.trials).toHaveLength(1);
    expect(stage.trials[0]).toMatchObject({
      trialNumber: 1,
      status: "discarded_overshoot",
      statusLabel: "Rejected (overshot)",
      statusTone: "danger",
      observedColour: "deep_pink",
      initialReadingMl: 0,
    });
    expect(stage.trials[0].observationLabel).toContain("overshot");
    expect(stage.concordance.status).toBe("not_started");
    expect(stage.concordance.discardedTrials).toEqual([1]);
  });

  it("reports concordance from the server summary and needs evidence first", () => {
    const session = freshSession();
    setup(session);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);

    runTrial(session, { trialNumber: 1, deliveredMl: hiddenTruth(session, STAGE_A).observableMl });
    reportMolarity(session, STAGE_A, 1, 0.1);
    let stage = viewFor(session).stages[0];
    expect(stage.concordance.status).toBe("insufficient_evidence");
    expect(stage.concordance.trialsStillNeeded).toBe(2);
    expect(stage.complete).toBe(false);

    for (let trial = 2; trial <= 3; trial += 1) {
      weighAnalyte(session, STAGE_A, 0.6);
      addIndicator(session, STAGE_A, 3);
      runTrial(session, {
        trialNumber: trial,
        deliveredMl: hiddenTruth(session, STAGE_A).observableMl,
      });
      reportMolarity(session, STAGE_A, trial, 0.1);
    }
    stage = viewFor(session).stages[0];
    expect(stage.concordance.status).toBe("concordant");
    expect(stage.concordance.summary).toContain("agree within");
    expect(stage.concordance.averageMolarityM).toBeGreaterThan(0);
    expect(stage.complete).toBe(true);
  });

  it("marks a spread that breaks the rule as not concordant", () => {
    const session = concordantStageASession();
    reportMolarity(session, STAGE_A, 3, 0.2);
    const stage = viewFor(session).stages[0];
    expect(stage.concordance.status).toBe("not_concordant");
    expect(stage.concordance.summary).toContain("do not agree");
  });

  it("counts progress across both configured stages", () => {
    const model = viewFor(concordantStageASession());
    expect(model.progress.requiredTrials).toBe(6);
    expect(model.progress.recordedTrials).toBe(3);
    expect(model.progress.percent).toBe(50);
    expect(model.stages).toHaveLength(2);
    // Stage A is finished, so the derived active stage is B.
    expect(model.activeStageKey).toBe("stage-b-hcl-naoh");
    expect(model.stages[0].complete).toBe(true);
  });

  it("honours an explicitly selected stage", () => {
    const model = viewFor(concordantStageASession(), { selectedStageKey: STAGE_A });
    expect(model.activeStageKey).toBe(STAGE_A);
    expect(model.stages[0].isActive).toBe(true);
  });

  it("offers no controls on a frozen attempt", () => {
    const model = viewFor(concordantStageASession(), { canWrite: false });
    expect(model.stages[0].nextAction?.kind).toBe("read_only");
  });

  it("lists the preparation checklist with the configuration's requirements", () => {
    const stage = viewFor(freshSession()).stages[0];
    const keys = stage.preparation.map((step) => step.key);
    expect(keys).toEqual([
      "clean_burette",
      "obtain_naoh_portion",
      "condition_burette",
      "setup_apparatus",
      "clear_air_bubble",
      "weigh_beaker",
      "dissolve_khp",
      "transfer_solution",
      "rinse_beaker",
      "add_indicator",
      "place_flask",
      "titrate",
      "concordance",
    ]);
    expect(stage.preparation[2].requires).toContain("Sodium hydroxide solution");
    expect(stage.preparation[5].detail).toContain("0.6 g");
    expect(stage.preparation[0].current).toBe(true);
    expect(stage.preparation[0].done).toBe(false);
  });

  it("projects Part I from the persisted working solution, ahead of every stage", () => {
    const session = freshSession();
    const step = () => viewFor(session).solution;

    expect(step().required).toBe(true);
    expect(step().stockMolarityM).toBe(2);
    expect(step().nominalWorkingMolarityM).toBeCloseTo(0.2, 5);
    expect(step().steps.map((s) => s.key)).toEqual([
      "measure_stock",
      "dilute_solution",
      "mix_solution",
    ]);
    expect(step().nextAction?.kind).toBe("measure_stock");
    expect(step().blockers).toHaveLength(1);
    // Part I is attempt-level, so every stage shows the same solution state.
    expect(viewFor(session).stages[1].trialBlockers.find((b) => /stock solution/i.test(b))).toBeDefined();

    expect(measureStockVolume(session, STAGE_A, 10).ok).toBe(true);
    expect(step().nextAction?.kind).toBe("dilute_solution");
    expect(step().steps[0].done).toBe(true);
    // The measured volume is the student's own reading, never a target.
    expect(step().stockVolumeMl).toBe(10);

    expect(diluteWorkingSolution(session, STAGE_A).ok).toBe(true);
    expect(step().nextAction?.kind).toBe("mix_solution");
    expect(mixWorkingSolution(session, STAGE_A).ok).toBe(true);
    expect(step().ready).toBe(true);
    expect(step().nextAction).toBeNull();
    expect(step().blockers).toEqual([]);
  });

  it("asks for the measuring cylinder on a measured-aliquot stage and never offers a balance", () => {
    const session = freshSession();
    const stageB = buildLabViewModel({
      config,
      publicState: toPublicJSON(session),
      chemicalLabels: {},
      apparatusLabels: {},
      selectedStageKey: "stage-b-hcl-naoh",
      canWrite: true,
    }).stages[1];
    const keys = stageB.preparation.map((step) => step.key);
    expect(keys).toContain("measure_analyte");
    expect(keys).not.toContain("weigh_beaker");
    expect(stageB.portion.kind).toBe("pipetted_volume");
    if (stageB.portion.kind !== "pipetted_volume") throw new Error("expected a measured aliquot");
    // The supplied manual names a measuring cylinder for the 25.00 mL aliquot.
    expect(stageB.portion.vessel).toBe("graduated_cylinder");
    expect(stageB.preparation.find((step) => step.key === "measure_analyte")?.label).toMatch(/cylinder/i);
  });

  it("falls back to the raw key when the public catalog has no name", () => {
    expect(chemicalLabel("hcl", {})).toBe("hcl");
    expect(chemicalLabel("distilled_water", {})).toBe("distilled water");
    expect(chemicalLabel("naoh", { naoh: "Sodium hydroxide solution" })).toBe(
      "Sodium hydroxide solution",
    );
  });

  it("maps flask colours to overlay opacities, none for the unobserved flask", () => {
    expect(flaskPinkOpacity(null)).toBe(0);
    expect(flaskPinkOpacity("colourless")).toBe(0);
    expect(flaskPinkOpacity("faint_pink")).toBeGreaterThan(0);
    expect(flaskPinkOpacity("faint_pink")).toBeLessThan(flaskPinkOpacity("pink"));
    expect(flaskPinkOpacity("pink")).toBeLessThan(flaskPinkOpacity("deep_pink"));
  });

  it("contains no hidden key anywhere in its output", () => {
    const serialised = JSON.stringify(
      viewFor(concordantStageASession(), { canWrite: false }),
    );
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    expect(serialised).not.toContain("phase-4-fixture-seed");
  });

  it("reconstructs the same view from the same persisted state (resume)", () => {
    const session = freshSession();
    setup(session);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
    startTrialAction(session, STAGE_A, 1, 0);
    addTitrant(session, STAGE_A, hiddenTruth(session, STAGE_A).observableMl);
    readBurette(session, STAGE_A, hiddenTruth(session, STAGE_A).observableMl);
    observeEndpoint(session, STAGE_A, "faint_pink");

    const first = JSON.stringify(viewFor(session));
    // The only input a reload has is the persisted public state.
    const reloaded = JSON.stringify(
      buildLabViewModel({
        config,
        publicState: JSON.parse(JSON.stringify(publicStateOf(session))),
        chemicalLabels: { khp: "Potassium hydrogen phthalate", naoh: "Sodium hydroxide solution" },
        apparatusLabels: { burette_50: "Burette, 50 mL" },
        selectedStageKey: null,
        canWrite: true,
      }),
    );
    expect(reloaded).toBe(first);
  });
});
