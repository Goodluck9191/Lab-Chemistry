import { describe, expect, it } from "vitest";
import {
  analytePortionAvailability,
  completionAvailability,
  CONTROL_REASONS,
  deliveryAvailability,
  indicatorAvailability,
  observationAvailability,
  readingAvailability,
  startTrialAvailability,
  stopcockAvailability,
  swirlAvailability,
  type LabControlFlags,
} from "@/components/lab/control-availability";
import { buildLabViewModel, type StageView } from "@/components/lab/view-model";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  concordantStageASession,
  freshSession,
  publicStateOf,
  STAGE_B,
} from "../helpers/titration-fixtures";

const OPEN_BENCH: LabControlFlags = { canWrite: true, pending: false, stopcockOpen: true };

function stageViewFor(session: Parameters<typeof publicStateOf>[0], stageKey: string): StageView {
  const model = buildLabViewModel({
    config: publicTitrationConfigView(exp02TitrationConfig),
    publicState: publicStateOf(session),
    chemicalLabels: {},
    apparatusLabels: {},
    selectedStageKey: stageKey,
    canWrite: true,
  });
  const stage = model.stages.find((entry) => entry.key === stageKey);
  if (!stage) throw new Error(`no stage ${stageKey}`);
  return stage;
}

describe("stage lock availability", () => {
  it("blocks every control on a locked stage with the stage-locked reason", () => {
    const locked = stageViewFor(freshSession(), STAGE_B);
    expect(locked.locked).toBe(true);

    const controls = [
      analytePortionAvailability(locked, OPEN_BENCH),
      indicatorAvailability(locked, OPEN_BENCH),
      startTrialAvailability(locked, OPEN_BENCH),
      stopcockAvailability(locked, OPEN_BENCH),
      deliveryAvailability(locked, OPEN_BENCH),
      readingAvailability(locked, OPEN_BENCH),
      completionAvailability(locked, OPEN_BENCH),
      observationAvailability(locked, OPEN_BENCH),
      swirlAvailability(locked, OPEN_BENCH),
    ];
    for (const control of controls) {
      expect(control).toEqual({ available: false, reason: CONTROL_REASONS.stageLocked });
    }
  });

  it("keeps the closed-attempt reason ahead of the stage lock", () => {
    const locked = stageViewFor(freshSession(), STAGE_B);
    const frozen: LabControlFlags = { canWrite: false, pending: false };
    expect(startTrialAvailability(locked, frozen)).toEqual({
      available: false,
      reason: CONTROL_REASONS.closed,
    });
  });

  it("leaves an unlocked stage's own rules untouched", () => {
    const unlocked = stageViewFor(concordantStageASession(), STAGE_B);
    expect(unlocked.locked).toBe(false);
    // Nothing prepared yet on Stage B: the preparation rule (not the lock) answers.
    expect(startTrialAvailability(unlocked, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.startNeedsPreparation,
    });
  });
});
