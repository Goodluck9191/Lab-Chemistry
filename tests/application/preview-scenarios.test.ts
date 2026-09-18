import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PREVIEW_SCENARIOS, scenarioStateFor } from "@/components/lab/preview/scenarios";

/**
 * The development preview renders its bench by replaying a script of REAL
 * protocol actions through the REAL router, and throws if the router refuses
 * one. These tests therefore do double duty: they keep the harness honest about
 * the procedure (an outdated script that skips Part I, cleaning or a discard
 * fails here instead of quietly drawing a wrong bench), and they pin the
 * payload shape the browser receives.
 */
describe("development preview scenarios", () => {
  it("replays every script through the real router without a refusal", () => {
    expect(PREVIEW_SCENARIOS.length).toBeGreaterThan(5);
    for (const scenario of PREVIEW_SCENARIOS) {
      // A refused script action throws inside the harness, so reaching past
      // this call already proves the script follows the enforced procedure.
      const state = scenarioStateFor(scenario.id);
      expect(state.experimentId, scenario.id).toBe("exp-02");
      expect(state.publicState.stages).toBeTruthy();
    }
  });

  it("prepares the working solution in every scenario that has left the start", () => {
    for (const scenario of PREVIEW_SCENARIOS) {
      const state = scenarioStateFor(scenario.id);
      const solution = state.publicState.solution;
      if (scenario.id === "fresh") {
        expect(solution, scenario.id).toMatchObject({ stockVolumeMl: null, diluted: false });
        continue;
      }
      // Part I is unavoidable: nothing past the fresh bench is reachable without
      // measuring, diluting and mixing the stock solution first.
      expect(solution, scenario.id).toMatchObject({ diluted: true, mixed: true });
      expect(solution.stockVolumeMl, scenario.id).toEqual(expect.any(Number));
    }
  });

  it("carries no hidden value in any scenario payload", () => {
    const serialised = PREVIEW_SCENARIOS.map((scenario) =>
      JSON.stringify(scenarioStateFor(scenario.id)),
    ).join("\n");
    for (const key of ["trueTitrantMolarityM", "equivalenceMl", "observableMl", "analyteMoles"]) {
      expect(serialised).not.toContain(key);
    }
    // The preview's own seeds are harness-only and must not travel either.
    for (const scenario of PREVIEW_SCENARIOS) {
      expect(serialised).not.toContain(scenario.seed);
    }
  });
});
