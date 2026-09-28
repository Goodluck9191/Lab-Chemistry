import { describe, expect, it } from "vitest";
import { buildLabViewModel, type StageView } from "@/components/lab/view-model";
import { buretteSetupAvailability, type LabControlFlags } from "@/components/lab/control-availability";
import { holdKindForReagent, holdVerbFor } from "@/components/lab/3d/interactions/carry";
import {
  DROP_INTERVAL_MS,
  clampDropsToRange,
  dropCountLabel,
  dropsForPourMs,
} from "@/components/lab/3d/interactions/drops";
import { pourActionFor, pourRefusalFor } from "@/components/lab/3d/interactions/pour-actions";
import { interactionHintFor } from "@/components/lab/3d/ui/hint";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  reconcileSessionPhases,
  reconcileStagePhase,
  setupApparatus,
  stageHasRecordedWork,
  startTrialAction,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import {
  resumeSessionFromSnapshot,
  secretsForStorage,
  snapshotFromSession,
} from "@/domain/simulation/titration/snapshot";
import { STAGE_A, freshSession, provisionStageA, publicStateOf, setup } from "../helpers/titration-fixtures";

/**
 * The stage rewind.
 *
 * Filling the burette a second time used to restart a prepared stage: the phase
 * went back to `setup` and the flask colour was cleared, but the weighings and
 * the indicator stayed recorded — leaving the bench claiming everything was done
 * while every gate refused the way forward. There was no route back either, so
 * the attempt could not be finished at all.
 *
 * These tests pin the two halves of the fix: the destructive re-fill is refused,
 * and a stage whose phase contradicts its own recorded preparation is healed
 * from the facts rather than from the stored enum.
 */

const VIEW_CONFIG = publicTitrationConfigView(exp02TitrationConfig);
const OPEN_BENCH: LabControlFlags = { canWrite: true, pending: false, stopcockOpen: false };
const EXPERIMENT_ID = "exp-02";

function stageViewFor(session: TitrationSession, stageKey: string = STAGE_A): StageView {
  const model = buildLabViewModel({
    config: VIEW_CONFIG,
    publicState: publicStateOf(session),
    chemicalLabels: {},
    apparatusLabels: {},
    selectedStageKey: stageKey,
    canWrite: true,
  });
  const stage = model.stages.find((entry) => entry.key === stageKey);
  if (!stage) throw new Error(`no stage view for ${stageKey}`);
  return stage;
}

describe("stageHasRecordedWork", () => {
  it("is false on a freshly filled stage and true once the sample is on record", () => {
    const fresh = freshSession();
    setup(fresh);
    expect(stageHasRecordedWork(fresh.public.stages[STAGE_A])).toBe(false);

    const prepared = freshSession();
    provisionStageA(prepared);
    expect(stageHasRecordedWork(prepared.public.stages[STAGE_A])).toBe(true);
  });
});

describe("filling the burette is a one-time step", () => {
  it("fills a fresh stage, and allows a mistyped reading to be corrected", () => {
    const session = freshSession();
    setup(session, STAGE_A, 0);
    expect(session.public.stages[STAGE_A].apparatusReady).toBe(true);

    // Nothing recorded yet: a second fill is a correction, not a rewrite.
    const corrected = setupApparatus(session, STAGE_A, "naoh", 0.4);
    expect(corrected.ok).toBe(true);
    expect(session.public.stages[STAGE_A].buretteInitialMl).toBe(0.4);
  });

  it("refuses a refill that would erase the sample and the indicator", () => {
    const session = freshSession();
    provisionStageA(session);
    const before = session.public.stages[STAGE_A];
    expect(before.phase).toBe("indicator_added");

    const refused = setupApparatus(session, STAGE_A, "naoh", 0);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected the refill to be refused");
    expect(refused.error).toMatch(/already set up/i);
    expect(refused.code).toBe("invalid_sequence");

    // The refusal is total: nothing the stage had recorded was disturbed.
    const after = session.public.stages[STAGE_A];
    expect(after.phase).toBe("indicator_added");
    expect(after.indicatorDrops).toBe(3);
    expect(after.analyteMassG).toBe(0.6);
    expect(after.preparation.flaskPlaced).toBe(true);
    expect(after.preparation.beakerRinses).toBe(2);
  });

  it("keeps the panel's reason and the engine's rule in step", () => {
    const prepared = freshSession();
    provisionStageA(prepared);
    const view = stageViewFor(prepared);
    expect(buretteSetupAvailability(view, OPEN_BENCH).available).toBe(false);
    expect(buretteSetupAvailability(view, OPEN_BENCH).reason).toMatch(/already/i);
    // The rule the reason describes is real: the engine refuses that action.
    expect(setupApparatus(prepared, STAGE_A, "naoh", 0).ok).toBe(false);

    // And the control is available exactly while the rule would accept it.
    const fresh = freshSession();
    setup(fresh);
    expect(buretteSetupAvailability(stageViewFor(fresh), OPEN_BENCH)).toEqual({
      available: true,
      reason: null,
    });
    expect(setupApparatus(fresh, STAGE_A, "naoh", 0.1).ok).toBe(true);
  });
});

describe("reconcileStagePhase", () => {
  it("lifts a rewound stage to the phase its recorded work implies", () => {
    const session = freshSession();
    provisionStageA(session);
    const stage = session.public.stages[STAGE_A];

    // Exactly the damage a second fill used to do.
    stage.phase = "setup";
    expect(reconcileStagePhase(stage)).toBe("indicator_added");
  });

  it("stops at the analyte when the indicator never went in", () => {
    const session = freshSession();
    provisionStageA(session);
    const stage = session.public.stages[STAGE_A];
    stage.indicatorDrops = null;
    stage.phase = "setup";
    expect(reconcileStagePhase(stage)).toBe("analyte_ready");
  });

  it("leaves an unstarted stage alone and never moves a phase backwards", () => {
    const fresh = freshSession();
    setup(fresh);
    // Nothing recorded: the phase is honest, so it stands.
    expect(reconcileStagePhase(fresh.public.stages[STAGE_A])).toBe("setup");
    expect(reconcileStagePhase({ ...fresh.public.stages[STAGE_A], phase: "reported" })).toBe(
      "reported",
    );

    const titrating = freshSession();
    provisionStageA(titrating);
    const stage = titrating.public.stages[STAGE_A];
    stage.phase = "titrating";
    expect(reconcileStagePhase(stage)).toBe("titrating");
  });

  it("heals every stage of a session in place", () => {
    const session = freshSession();
    provisionStageA(session);
    session.public.stages[STAGE_A].phase = "setup";
    reconcileSessionPhases(session);
    expect(session.public.stages[STAGE_A].phase).toBe("indicator_added");
  });
});

describe("a rewound attempt becomes finishable again", () => {
  it("heals on dispatch, so the trial the student was locked out of can start", () => {
    const session = freshSession();
    provisionStageA(session);
    session.public.stages[STAGE_A].phase = "setup";

    const outcome = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 1,
      initialReadingMl: 0,
    });
    expect(outcome.accepted).toBe(true);
    expect(session.public.stages[STAGE_A].openTrial?.trialNumber).toBe(1);
  });

  it("heals a snapshot that was written while the phase was wrong", () => {
    const session = freshSession();
    provisionStageA(session);
    const secrets = secretsForStorage("rewind-seed", session);
    const snapshot = snapshotFromSession(session);
    if (!snapshot.titration) throw new Error("fixture snapshot has no titration session");
    snapshot.titration.stages[STAGE_A].phase = "setup";

    const resumed = resumeSessionFromSnapshot(exp02TitrationConfig, secrets, snapshot);
    expect(resumed.public.stages[STAGE_A].phase).toBe("indicator_added");
    expect(resumed.public.stages[STAGE_A].indicatorDrops).toBe(3);

    const outcome = dispatchTitrationAction(resumed, EXPERIMENT_ID, {
      type: "start_trial",
      stageKey: STAGE_A,
      trialNumber: 1,
      initialReadingMl: 0,
    });
    expect(outcome.accepted).toBe(true);
  });
});

describe("counting drops out of the dropper", () => {
  it("releases one drop per interval, and at least one for any real pour", () => {
    expect(dropsForPourMs(0)).toBe(0);
    expect(dropsForPourMs(-1)).toBe(0);
    expect(dropsForPourMs(Number.NaN)).toBe(0);
    // One drop falls as soon as the dropper is tipped, then one per interval:
    // tipping for a second and a half of a 450 ms interval is three drops.
    expect(dropsForPourMs(50)).toBe(1);
    expect(dropsForPourMs(DROP_INTERVAL_MS - 1)).toBe(1);
    expect(dropsForPourMs(DROP_INTERVAL_MS)).toBe(2);
    expect(dropsForPourMs(DROP_INTERVAL_MS * 2)).toBe(3);
  });

  it("clamps the count into the range the experiment documents", () => {
    expect(clampDropsToRange(1, [2, 3])).toBe(2);
    expect(clampDropsToRange(9, [2, 3])).toBe(3);
    expect(clampDropsToRange(2.4, [2, 3])).toBe(2);
    expect(clampDropsToRange(0, [2, 3])).toBe(2);
    // A malformed range cannot invert the answer, and the domain's own 1..20
    // bounds still hold.
    expect(clampDropsToRange(5, [3, 2])).toBe(3);
    expect(clampDropsToRange(99, [1, 20])).toBe(20);
  });

  it("tells the student what the dropper has given so far", () => {
    expect(dropCountLabel(0, [2, 3])).toContain("2–3 drops");
    expect(dropCountLabel(2, [2, 3])).toMatch(/^2 drops/);
    expect(dropCountLabel(1, [2, 3])).toMatch(/^1 drop/);
    expect(dropCountLabel(2, [2, 3])).toMatch(/level off/i);
  });
});

describe("the dropper is a holdable reagent", () => {
  const indicatorKey = VIEW_CONFIG.stages[0].indicator.key;

  it("is pickable when it is the selected reagent, and nothing else is", () => {
    expect(holdKindForReagent(indicatorKey, indicatorKey)).toBe("indicator");
    expect(holdKindForReagent("distilled_water", indicatorKey)).toBeNull();
    expect(holdKindForReagent(null, indicatorKey)).toBeNull();
    expect(holdKindForReagent(indicatorKey, null)).toBeNull();
  });

  it("promises a pick-up only where E delivers one", () => {
    expect(holdVerbFor("reagent_bottle", null, "indicator")).toEqual({
      label: "Pick up",
      picksUp: true,
    });
    expect(holdVerbFor("reagent_bottle", null, null).label).toBe("Interact");
    expect(holdVerbFor("reagent_bottle", "indicator", "indicator").label).toBe("Set down");
  });
});

describe("a completed pour becomes one domain action", () => {
  const OPEN: { canWrite: boolean; pending: boolean; dropsPoured: number } = {
    canWrite: true,
    pending: false,
    dropsPoured: 0,
  };

  it("records the indicator with the drops the gesture released, clamped to the config", () => {
    const session = freshSession();
    provisionStageA(session);
    const stage = session.public.stages[STAGE_A];
    // Everything prepared except the indicator: the dropper's moment.
    stage.indicatorDrops = null;
    stage.phase = "analyte_ready";
    const view = stageViewFor(session);
    const [min, max] = view.indicator.dropsRange;

    expect(pourActionFor("indicator", "flask", { ...OPEN, stage: view, dropsPoured: min })).toEqual(
      { type: "add_indicator", stageKey: STAGE_A, drops: min },
    );
    // A long squeeze is bounded by the range the experiment documents, and a
    // short one still delivers enough to work.
    const long = pourActionFor("indicator", "flask", {
      ...OPEN,
      stage: view,
      dropsPoured: 99,
    });
    const short = pourActionFor("indicator", "flask", { ...OPEN, stage: view, dropsPoured: 1 });
    expect(long).toMatchObject({ drops: max });
    expect(short).toMatchObject({ drops: min });

    // The engine accepts exactly what the gesture produced.
    const accepted = dispatchTitrationAction(session, EXPERIMENT_ID, {
      type: "add_indicator",
      stageKey: STAGE_A,
      drops: min,
    });
    expect(accepted.accepted).toBe(true);
    expect(session.public.stages[STAGE_A].phase).toBe("indicator_added");
  });

  it("keeps the beaker's own chain, and says nothing once it is finished", () => {
    const session = freshSession();
    provisionStageA(session);
    const stage = session.public.stages[STAGE_A];
    // Both transfer and rinses done: the beaker has nothing left to pour.
    expect(pourActionFor("beaker", "flask", { ...OPEN, stage: stageViewFor(session) })).toBeNull();
    expect(pourRefusalFor("beaker", "flask", { ...OPEN, stage: stageViewFor(session) })).toBeNull();

    // Rinses outstanding: tipping it again is the second rinse.
    stage.preparation.beakerRinses = 1;
    const midway = stageViewFor(session);
    expect(pourActionFor("beaker", "flask", { ...OPEN, stage: midway })).toEqual({
      type: "rinse_beaker",
      stageKey: STAGE_A,
    });
  });

  it("explains a dropper that has already been used, and pours nothing anywhere else", () => {
    const session = freshSession();
    provisionStageA(session);
    const view = stageViewFor(session);

    expect(pourActionFor("indicator", "flask", { ...OPEN, stage: view, dropsPoured: 3 })).toBeNull();
    expect(pourRefusalFor("indicator", "flask", { ...OPEN, stage: view, dropsPoured: 3 })).toMatch(
      /already been added/i,
    );
    // Tipped over the bench or the balance, a dropper is just a dropper.
    expect(pourActionFor("indicator", "bench", { ...OPEN, stage: view, dropsPoured: 3 })).toBeNull();
    expect(pourRefusalFor("indicator", "bench", { ...OPEN, stage: view, dropsPoured: 3 })).toBeNull();
  });

  it("refuses a pour on a read-only bench with the panel's own reason", () => {
    const session = freshSession();
    provisionStageA(session);
    const stage = session.public.stages[STAGE_A];
    stage.indicatorDrops = null;
    stage.phase = "analyte_ready";
    const view = stageViewFor(session);
    const closed = { canWrite: false, pending: false, dropsPoured: 3, stage: view };

    expect(pourActionFor("indicator", "flask", closed)).toBeNull();
    expect(pourRefusalFor("indicator", "flask", closed)).toMatch(/read-only|submitted/i);
  });
});

describe("the laboratory says why a thing will not work", () => {
  it("explains a valve that cannot turn yet, and names the mounting state once it can", () => {
    const fresh = freshSession();
    const blocked = interactionHintFor({
      subject: "burette",
      carried: null,
      stage: stageViewFor(fresh),
      flags: OPEN_BENCH,
    });
    expect(blocked).toMatch(/fill the burette/i);

    // Prepared AND running a trial: now the valve is live, so the hint names
    // where the burette physically is instead of refusing.
    const prepared = freshSession();
    provisionStageA(prepared);
    startTrialAction(prepared, STAGE_A, 1, 0);
    const ready = interactionHintFor({
      subject: "burette",
      carried: null,
      stage: stageViewFor(prepared),
      flags: OPEN_BENCH,
    });
    expect(ready).toMatch(/mounted/i);
  });

  it("points at the dropper when the indicator is the step outstanding", () => {
    // Everything prepared except the indicator: the state in which a student
    // used to hunt through the action card for a hidden button.
    const session = freshSession();
    provisionStageA(session);
    const stage = session.public.stages[STAGE_A];
    stage.indicatorDrops = null;
    stage.phase = "analyte_ready";
    const view = stageViewFor(session);
    const hint = interactionHintFor({
      subject: "conical_flask",
      carried: null,
      stage: view,
      flags: OPEN_BENCH,
    });
    expect(view.nextAction?.kind).toBe("add_indicator");
    const [min, max] = view.indicator.dropsRange;
    expect(hint).toMatch(/dropper/i);
    // The count named is the config's, not a number hard-coded in the hint.
    expect(hint).toContain(`${min}–${max} drops`);
  });

  it("stays quiet with a full hand, or without a stage", () => {
    const session = freshSession();
    setup(session);
    expect(
      interactionHintFor({
        subject: "burette",
        carried: "beaker",
        stage: stageViewFor(session),
        flags: OPEN_BENCH,
      }),
    ).toBeNull();
    expect(
      interactionHintFor({ subject: "burette", carried: null, stage: null, flags: OPEN_BENCH }),
    ).toBeNull();
  });
});
