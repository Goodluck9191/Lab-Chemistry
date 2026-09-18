import { describe, expect, it } from "vitest";
import {
  airBubbleAvailability,
  beakerWeighAvailability,
  conditionBuretteAvailability,
  CONTROL_REASONS,
  discardAvailability,
  dissolveAvailability,
  placeFlaskAvailability,
  rinseBeakerAvailability,
  rinseBuretteAvailability,
  transferAvailability,
  type LabControlFlags,
} from "@/components/lab/control-availability";
import { buildLabViewModel, type StageView } from "@/components/lab/view-model";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import type { TitrationSession } from "@/domain/simulation/titration/engine";
import {
  freshSession,
  provisionStageA,
  publicStateOf,
  runTrial,
  setup,
  STAGE_A,
} from "../helpers/titration-fixtures";

const OPEN_BENCH: LabControlFlags = { canWrite: true, pending: false };

function stageViewFor(session: TitrationSession): StageView {
  const model = buildLabViewModel({
    config: publicTitrationConfigView(exp02TitrationConfig),
    publicState: publicStateOf(session),
    chemicalLabels: {},
    apparatusLabels: {},
    selectedStageKey: STAGE_A,
    canWrite: true,
  });
  const stage = model.stages.find((entry) => entry.key === STAGE_A);
  if (!stage) throw new Error("no stage A");
  return stage;
}

function provisioned(): TitrationSession {
  const session = freshSession();
  provisionStageA(session);
  return session;
}

/**
 * Preparation availability mirrors the engine and the trial gate: every reason
 * below is paired with the real refusal, so a hint can never outlive the rule
 * it describes. The frozen/pending gates still come first.
 */
describe("preparation availability", () => {
  it("opens the burette chain in order: rinse, condition x3, bubble after fill", () => {
    const fresh = stageViewFor(freshSession());
    expect(rinseBuretteAvailability(fresh, OPEN_BENCH)).toEqual({
      available: true,
      reason: null,
    });
    expect(conditionBuretteAvailability(fresh, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.conditionNeedsClean,
    });
    expect(airBubbleAvailability(fresh, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.bubbleNeedsBurette,
    });

    const session = freshSession();
    setup(session);
    const filled = stageViewFor(session);
    expect(airBubbleAvailability(filled, OPEN_BENCH)).toEqual({
      available: true,
      reason: null,
    });

    const ready = stageViewFor(provisioned());
    expect(rinseBuretteAvailability(ready, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.buretteAlreadyClean,
    });
    expect(conditionBuretteAvailability(ready, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.buretteAlreadyConditioned,
    });
    expect(airBubbleAvailability(ready, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.bubbleAlreadyCleared,
    });
  });

  it("weighs by difference until the pair is complete", () => {
    const session = freshSession();
    setup(session);
    const weighing = stageViewFor(session);
    expect(beakerWeighAvailability(weighing, OPEN_BENCH)).toEqual({
      available: true,
      reason: null,
    });

    const done = stageViewFor(provisioned());
    expect(beakerWeighAvailability(done, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.beakerWeighingsDone,
    });
  });

  it("dissolves, transfers and rinses in order", () => {
    const session = freshSession();
    setup(session);
    const weighing = stageViewFor(session);
    expect(dissolveAvailability(weighing, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.dissolveNeedsSample,
    });
    expect(transferAvailability(weighing, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.transferNeedsDissolved,
    });
    expect(rinseBeakerAvailability(weighing, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.beakerRinseNeedsTransfer,
    });

    const done = stageViewFor(provisioned());
    expect(dissolveAvailability(done, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.khpAlreadyDissolved,
    });
    expect(transferAvailability(done, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.solutionAlreadyTransferred,
    });
    expect(rinseBeakerAvailability(done, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.beakerAlreadyRinsed,
    });
  });

  it("places the flask once, after the burette is filled", () => {
    expect(placeFlaskAvailability(stageViewFor(freshSession()), OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.placeNeedsBurette,
    });
    const session = freshSession();
    setup(session);
    expect(placeFlaskAvailability(stageViewFor(session), OPEN_BENCH)).toEqual({
      available: true,
      reason: null,
    });
    expect(placeFlaskAvailability(stageViewFor(provisioned()), OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.flaskAlreadyPlaced,
    });
  });

  it("offers disposal only for an undiscarded completed trial", () => {
    expect(discardAvailability(stageViewFor(freshSession()), OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.discardNothingToDiscard,
    });

    const session = freshSession();
    provisionStageA(session);
    runTrial(session, { trialNumber: 1, deliveredMl: 15 });
    expect(discardAvailability(stageViewFor(session), OPEN_BENCH)).toEqual({
      available: true,
      reason: null,
    });
  });

  it("keeps the closed-attempt reason ahead of every preparation rule", () => {
    const frozen: LabControlFlags = { canWrite: false, pending: false };
    const stage = stageViewFor(freshSession());
    for (const control of [
      rinseBuretteAvailability(stage, frozen),
      conditionBuretteAvailability(stage, frozen),
      airBubbleAvailability(stage, frozen),
      beakerWeighAvailability(stage, frozen),
      dissolveAvailability(stage, frozen),
      transferAvailability(stage, frozen),
      rinseBeakerAvailability(stage, frozen),
      placeFlaskAvailability(stage, frozen),
      discardAvailability(stage, frozen),
    ]) {
      expect(control).toEqual({ available: false, reason: CONTROL_REASONS.closed });
    }
  });
});
