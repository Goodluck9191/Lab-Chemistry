import { describe, expect, it } from "vitest";
import { buildLabViewModel } from "@/components/lab/view-model";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  concordantFullSession,
  concordantStageASession,
  freshSession,
  publicStateOf,
  STAGE_A,
} from "../helpers/titration-fixtures";

function viewFor(
  session: Parameters<typeof publicStateOf>[0],
  overrides: { selectedStageKey?: string | null; canWrite?: boolean } = {},
) {
  return buildLabViewModel({
    config: publicTitrationConfigView(exp02TitrationConfig),
    publicState: publicStateOf(session),
    chemicalLabels: {},
    apparatusLabels: {},
    selectedStageKey: overrides.selectedStageKey ?? null,
    canWrite: overrides.canWrite ?? true,
  });
}

describe("workflow view model", () => {
  it("locks the second stage behind the first on a fresh session", () => {
    const model = viewFor(freshSession());
    expect(model.stages[0]).toMatchObject({ locked: false, lockedBy: null, complete: false });
    expect(model.stages[1]).toMatchObject({
      locked: true,
      lockedBy: model.stages[0].title,
      complete: false,
    });
  });

  it("unlocks the second stage once the first is concordant", () => {
    const model = viewFor(concordantStageASession());
    expect(model.stages[0]).toMatchObject({ locked: false, complete: true });
    expect(model.stages[1]).toMatchObject({ locked: false, lockedBy: null });
    expect(model.activeStageKey).toBe(model.stages[1].key);
  });

  it("points the finished experiment at review and submit", () => {
    const model = viewFor(concordantFullSession());
    const active = model.stages.find((stage) => stage.isActive)!;
    expect(active.nextAction?.kind).toBe("review_submit");
    expect(active.nextAction?.title).toContain("Review");
  });

  it("keeps a frozen finished attempt read-only instead of reviewable", () => {
    const model = viewFor(concordantFullSession(), { canWrite: false });
    const active = model.stages.find((stage) => stage.isActive)!;
    expect(active.nextAction?.kind).toBe("read_only");
  });

  it("never locks the first stage", () => {
    const model = viewFor(concordantFullSession(), { selectedStageKey: STAGE_A });
    expect(model.stages[0].locked).toBe(false);
  });
});
