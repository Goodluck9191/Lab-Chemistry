import { describe, expect, it, vi } from "vitest";
import {
  isControlFlowError,
  runLabAction,
  type LabActionDependencies,
} from "@/application/attempts/lab-transport";
import type { TitrationActionResult } from "@/application/attempts/apply-simulation-action";
import { RevisionConflictError } from "@/infrastructure/supabase/repositories/attempts";
import { toPublicJSON } from "@/domain/simulation/titration/engine";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { concordantStageASession, freshSession } from "../helpers/titration-fixtures";

vi.mock("server-only", () => ({}));

const ATTEMPT_ID = "123e4567-e89b-12d3-a456-426614174000";

function acceptedResult(revision = 5): TitrationActionResult {
  return {
    accepted: true,
    code: null,
    message: null,
    revision,
    public: toPublicJSON(concordantStageASession()),
    colour: "faint_pink",
    calculationCorrect: null,
  };
}

function deps(overrides: Partial<LabActionDependencies> = {}): LabActionDependencies {
  return {
    apply: vi.fn(async () => acceptedResult()),
    reload: vi.fn(async () => ({
      revision: 9,
      publicState: toPublicJSON(concordantStageASession()),
    })),
    ...overrides,
  };
}

const input = { attemptId: ATTEMPT_ID, baseRevision: 4, action: { type: "complete_trial" } };

describe("laboratory action transport", () => {
  it("passes an accepted action through with the new revision and public state", async () => {
    const outcome = await runLabAction(deps(), { attemptId: ATTEMPT_ID }, input);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.accepted).toBe(true);
    expect(outcome.revision).toBe(5);
    expect(outcome.colour).toBe("faint_pink");
    expect(Object.keys(outcome.publicState.stages)).toContain("stage-a-khp-naoh");
  });

  it("passes a refusal by the engine through as ok + accepted:false", async () => {
    const outcome = await runLabAction(
      deps({
        apply: vi.fn(async () => ({
          accepted: false,
          code: "invalid_sequence",
          message: "read the burette before completing the trial",
          revision: 6,
          public: toPublicJSON(freshSession()),
          colour: null,
          calculationCorrect: null,
        })),
      }),
      { attemptId: ATTEMPT_ID },
      input,
    );
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe("invalid_sequence");
    // The engine's message is written for students and is passed through as-is.
    expect(outcome.message).toContain("read the burette");
  });

  it("turns a stale revision into a conflict carrying the refreshed state", async () => {
    const reload = vi.fn(async () => ({
      revision: 12,
      publicState: toPublicJSON(concordantStageASession()),
    }));
    const outcome = await runLabAction(
      deps({
        apply: vi.fn(async () => {
          throw new RevisionConflictError(ATTEMPT_ID, 4);
        }),
        reload,
      }),
      { attemptId: ATTEMPT_ID },
      input,
    );

    expect(reload).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(outcome.status).toBe("conflict");
    if (outcome.status !== "conflict") throw new Error("unreachable");
    expect(outcome.revision).toBe(12);
    expect(outcome.message).toContain("refreshed");
    expect(outcome.publicState.stages["stage-a-khp-naoh"].concordance.recordedTrials).toBe(3);
  });

  it("reports a conflict whose refresh also failed without claiming success", async () => {
    const outcome = await runLabAction(
      deps({
        apply: vi.fn(async () => {
          throw new RevisionConflictError(ATTEMPT_ID, 4);
        }),
        reload: vi.fn(async () => {
          throw new Error("network down");
        }),
      }),
      { attemptId: ATTEMPT_ID },
      input,
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("unreachable");
    expect(outcome.code).toBe("conflict_reload_failed");
  });

  it("maps a protocol mismatch to a reload instruction, not a silent failure", async () => {
    const outcome = await runLabAction(
      deps({
        apply: vi.fn(async () => {
          throw new Error("invalid simulation action: invalid literal value");
        }),
        reload: vi.fn(),
      }),
      { attemptId: ATTEMPT_ID },
      input,
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("unreachable");
    expect(outcome.code).toBe("protocol_mismatch");
    expect(outcome.message).toMatch(/reload/i);
  });

  it("maps any other failure to a retryable rejection and never leaks the cause", async () => {
    const outcome = await runLabAction(
      deps({
        apply: vi.fn(async () => {
          throw new Error("permission denied for table attempt_secrets (seed=abc)");
        }),
        reload: vi.fn(),
      }),
      { attemptId: ATTEMPT_ID },
      input,
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("unreachable");
    expect(outcome.code).toBe("action_failed");
    expect(outcome.message).not.toContain("attempt_secrets");
    expect(outcome.message).not.toContain("seed");
  });

  it("rethrows framework control-flow errors instead of hiding a redirect", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    expect(isControlFlowError(redirectError)).toBe(true);
    await expect(
      runLabAction(
        deps({
          apply: vi.fn(async () => {
            throw redirectError;
          }),
        }),
        { attemptId: ATTEMPT_ID },
        input,
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
  });

  it("never carries a hidden key in any outcome", async () => {
    const outcomes = [
      await runLabAction(deps(), { attemptId: ATTEMPT_ID }, input),
      await runLabAction(
        deps({
          apply: vi.fn(async () => {
            throw new RevisionConflictError(ATTEMPT_ID, 4);
          }),
        }),
        { attemptId: ATTEMPT_ID },
        input,
      ),
      await runLabAction(
        deps({
          apply: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
        { attemptId: ATTEMPT_ID },
        input,
      ),
    ];

    for (const outcome of outcomes) {
      const serialised = JSON.stringify(outcome);
      for (const key of HIDDEN_KEY_DENYLIST) {
        expect(serialised).not.toContain(`"${key}"`);
      }
      expect(serialised).not.toContain("fixture-seed");
    }
  });
});
