import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { toPublicJSON } from "@/domain/simulation/titration/engine";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import { projectExperimentWorkflow } from "@/domain/simulation/titration/workflow";
import { submitBlockersFor } from "@/application/attempts/submit-attempt";
import { labStateViewFor } from "../helpers/lab-fixture";
import {
  concordantFullSession,
  freshSession,
  hiddenTruth,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

/**
 * SECURITY OF THE PHASE 5 SURFACE.
 *
 * The workflow adds three things the browser can see: the checklist
 * projection, the `stage_locked` refusal and the submit blockers. This suite
 * asserts — over the serialised JSON — that none of them can carry the hidden
 * reality, following the pattern of `tests/security/lab-exposure.test.ts`.
 */
function hiddenValues(seed: string): { session: ReturnType<typeof freshSession>; forbidden: string[] } {
  const session = freshSession(seed);
  const truthA = hiddenTruth(session, STAGE_A);
  const truthB = hiddenTruth(session, STAGE_B);
  return {
    session,
    forbidden: [
      seed,
      truthA.trueTitrantMolarityM.toString(),
      truthB.trueAnalyteMolarityM?.toString() ?? "unused",
      truthA.analyteMoles.toString(),
      truthB.analyteMoles.toString(),
      truthA.equivalenceMl.toFixed(2),
      truthB.equivalenceMl.toFixed(2),
    ],
  };
}

function expectNoHiddenValues(serialised: string, forbidden: string[]): void {
  for (const key of HIDDEN_KEY_DENYLIST) {
    expect(serialised).not.toContain(`"${key}"`);
  }
  for (const value of forbidden) {
    expect(serialised).not.toContain(value);
  }
}

const REQUIRED_OBSERVATION = [
  { fieldKey: "colour_change", prompt: "Describe the colour change." },
];

describe("phase 5 workflow exposure", () => {
  it("projects a checklist with no hidden key and no hidden value", () => {
    const { session, forbidden } = hiddenValues("workflow-exposure-seed");
    const workflow = projectExperimentWorkflow(
      exp02TitrationConfig,
      toPublicJSON(session),
      REQUIRED_OBSERVATION,
    );
    expectNoHiddenValues(JSON.stringify(workflow), forbidden);
  });

  it("refuses a locked stage without naming anything hidden", () => {
    const { session, forbidden } = hiddenValues("stage-lock-exposure-seed");
    const outcome = dispatchTitrationAction(session, "exp-02", {
      type: "setup_apparatus",
      stageKey: STAGE_B,
      titrantKey: "naoh",
      initialReadingMl: 0,
    });
    expect(outcome.code).toBe("stage_locked");
    expectNoHiddenValues(JSON.stringify(outcome), forbidden);
  });

  it("words submit blockers without hidden values", () => {
    const { session, forbidden } = hiddenValues("blockers-exposure-seed");
    const blockers = submitBlockersFor("exp-02", exp02TitrationConfig, toPublicJSON(session));
    expect(blockers.length).toBeGreaterThan(0);
    expectNoHiddenValues(JSON.stringify(blockers), forbidden);
  });

  it("ships a report draft with no hidden key and no hidden value", () => {
    const { forbidden } = hiddenValues("report-exposure-seed");
    const session = concordantFullSession("report-exposure-seed");
    const state = labStateViewFor(session, {
      report: {
        status: "draft",
        aim: "Standardise the NaOH.",
        procedure: "Titrate.",
        resultsSummary: "Concordant.",
        conclusion: "Done.",
        safetyNotes: "Goggles.",
        answers: {},
        submittedAt: null,
      },
    });
    expectNoHiddenValues(JSON.stringify(state), forbidden);
  });
});
