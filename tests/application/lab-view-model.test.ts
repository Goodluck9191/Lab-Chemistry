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
  observeEndpoint,
  readBurette,
  reportMolarity,
  startTrialAction,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import { toPublicJSON } from "@/domain/simulation/titration/engine";
import {
  STAGE_A,
  concordantStageASession,
  freshSession,
  hiddenTruth,
  overshotStageASession,
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
  it("starts a fresh attempt by asking for the burette, then the sample, then the indicator", () => {
    const session = freshSession();
    expect(viewFor(session).stages[0].nextAction?.kind).toBe("setup_apparatus");

    setup(session);
    expect(viewFor(session).stages[0].nextAction?.kind).toBe("weigh_analyte");

    weighAnalyte(session, STAGE_A, 0.6);
    expect(viewFor(session).stages[0].nextAction?.kind).toBe("add_indicator");

    addIndicator(session, STAGE_A, 3);
    expect(viewFor(session).stages[0].nextAction?.kind).toBe("start_trial");
  });

  it("moves through titrating, reading, completing and reporting", () => {
    const session = freshSession();
    setup(session);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
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
    setup(session);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
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
      "setup_apparatus",
      "weigh_analyte",
      "add_indicator",
      "titrate",
      "concordance",
    ]);
    expect(stage.preparation[0].requires).toContain("Sodium hydroxide solution");
    expect(stage.preparation[1].detail).toContain("0.6 g");
    expect(stage.preparation[0].current).toBe(true);
    expect(stage.preparation[0].done).toBe(false);
  });

  it("asks for the pipette on a pipetted stage and never offers a balance", () => {
    const session = freshSession();
    const stageB = buildLabViewModel({
      config,
      publicState: toPublicJSON(session),
      chemicalLabels: {},
      apparatusLabels: {},
      selectedStageKey: "stage-b-hcl-naoh",
      canWrite: true,
    }).stages[1];
    expect(stageB.preparation.map((step) => step.key)).toContain("pipette_analyte");
    expect(stageB.preparation.map((step) => step.key)).not.toContain("weigh_analyte");
    expect(stageB.portion.kind).toBe("pipetted_volume");
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
