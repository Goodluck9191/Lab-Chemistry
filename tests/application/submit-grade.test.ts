import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { recordObservation, toPublicJSON } from "@/domain/simulation/titration/engine";
import { saveReportAnswers } from "@/infrastructure/supabase/repositories/attempts";
import { persistAutoGrade } from "@/application/attempts/grade-attempt";
import { submitBlockersFor } from "@/application/attempts/submit-attempt";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  freshSession,
  provisionedFullSession,
  STAGE_A,
} from "../helpers/titration-fixtures";

type Result = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });

/** Minimal chainable fake that records terminal writes in order. */
function recordingClient() {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    eq: () => query,
    order: () => query,
    select: () => query,
    maybeSingle: () => Promise.resolve(ok(null)),
    single: () => Promise.resolve(ok(null)),
    then: (onF: unknown, onR: unknown) => {
      calls.push({ table: "?", op: "terminal" });
      return Promise.resolve(ok([])).then(onF as (v: Result) => unknown, onR as (e: unknown) => unknown);
    },
  };
  const client = {
    from: (table: string) => ({
      update: (payload: unknown) => {
        calls.push({ table, op: "update", payload });
        return query;
      },
      insert: (payload: unknown) => {
        calls.push({ table, op: "insert", payload });
        return query;
      },
      upsert: (payload: unknown, opts?: unknown) => {
        calls.push({ table, op: "upsert", payload: { payload, opts } });
        return query;
      },
      select: () => {
        calls.push({ table, op: "select" });
        return query;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ATTEMPT_ID = "123e4567-e89b-12d3-a456-426614174000";

const FULL_ANSWERS: Record<string, string> = {
  q_aim: "Determine concentration by titration.",
  q_water_volume: "Moles unchanged.",
  q_water_type: "Distilled water.",
  q_weighing_difference: "No transfer loss.",
  q_naoh_effects: "Higher then lower.",
  q_acid_effects: "Lower then higher.",
};

const FULL_SECTIONS = {
  aim: "a",
  procedure: "p",
  resultsSummary: "r",
  conclusion: "c",
  safetyNotes: "s",
};

describe("submit gate with report requirements", () => {
  it("stays blocked on unanswered questions and a missing conclusion", () => {
    const session = provisionedFullSession("gate-report-seed");
    expect(recordObservation(session, STAGE_A, "colour_change", "Colourless to faint pink.").ok).toBe(true);
    const withoutReport = submitBlockersFor("exp-02", exp02TitrationConfig, toPublicJSON(session));
    expect(withoutReport).toEqual([]);

    const blockers = submitBlockersFor("exp-02", exp02TitrationConfig, toPublicJSON(session), {
      answers: {},
      conclusion: "  ",
    });
    expect(blockers.some((blocker) => blocker.includes("q_aim"))).toBe(true);
    expect(blockers.some((blocker) => blocker.includes("conclusion"))).toBe(true);
  });

  it("clears when questions are answered and the conclusion is written", () => {
    const session = provisionedFullSession("gate-clear-seed");
    expect(recordObservation(session, STAGE_A, "colour_change", "Colourless to faint pink.").ok).toBe(true);
    expect(
      submitBlockersFor("exp-02", exp02TitrationConfig, toPublicJSON(session), {
        answers: FULL_ANSWERS,
        conclusion: "Done.",
      }),
    ).toEqual([]);
  });
});

describe("automatic grade persistence (privileged writes)", () => {
  it("upserts the grade row pending without a grader and marks calculations", async () => {
    const { client, calls } = recordingClient();
    const { gradeAttemptOnSubmit } = await import("@/application/attempts/grade-attempt");
    const session = provisionedFullSession("persist-grade-seed");
    expect(recordObservation(session, STAGE_A, "colour_change", "Colourless to faint pink.").ok).toBe(true);
    const graded = gradeAttemptOnSubmit({
      session,
      config: exp02TitrationConfig,
      experimentId: "exp-02",
      answers: FULL_ANSWERS,
      sections: FULL_SECTIONS,
    });
    await persistAutoGrade(client, ATTEMPT_ID, graded);

    const gradeUpsert = calls.find((call) => call.table === "grades" && call.op === "upsert");
    expect(gradeUpsert).toBeDefined();
    const payload = (gradeUpsert?.payload as { payload: Record<string, unknown> }).payload;
    expect(payload.attempt_id).toBe(ATTEMPT_ID);
    expect(payload.decision).toBe("pending");
    expect(payload).not.toHaveProperty("graded_by");
    expect(payload).not.toHaveProperty("final_score");
    expect(typeof payload.auto_score).toBe("number");

    const calcUpdates = calls.filter(
      (call) => call.table === "calculation_submissions" && call.op === "update",
    );
    expect(calcUpdates).toHaveLength(6);
    for (const update of calcUpdates) {
      const patch = update.payload as Record<string, unknown>;
      expect(patch).toHaveProperty("expected_value");
      expect(patch).toHaveProperty("tolerance");
      expect(patch).toHaveProperty("is_correct");
      expect(patch).not.toHaveProperty("student_value");
    }
  });
});

describe("report answers repository (offline fake)", () => {
  it("writes only the answers column through the idempotent path", async () => {
    const { client, calls } = recordingClient();
    await saveReportAnswers(client, ATTEMPT_ID, { q_aim: "To standardise." });
    const update = calls.find((call) => call.table === "reports" && call.op === "update");
    expect(update?.payload).toEqual({ answers: { q_aim: "To standardise." } });
  });
});

describe("fresh attempt still gates on bench work first", () => {
  it("lists experiment blockers before report blockers", () => {
    const blockers = submitBlockersFor("exp-02", exp02TitrationConfig, toPublicJSON(freshSession()), {
      answers: {},
      conclusion: "",
    });
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers[0]).toMatch(/Stage|Prepare|Measure/);
  });
});
