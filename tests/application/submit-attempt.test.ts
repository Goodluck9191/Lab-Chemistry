import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { recordObservation, toPublicJSON } from "@/domain/simulation/titration/engine";
import {
  getReportForAttempt,
  markAttemptSubmitted,
  submitReportForAttempt,
  upsertReportDraft,
} from "@/infrastructure/supabase/repositories/attempts";
import { submitBlockersFor } from "@/application/attempts/submit-attempt";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  concordantFullSession,
  freshSession,
  STAGE_A,
} from "../helpers/titration-fixtures";

type Result = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });

/** Minimal chainable fake: terminal awaits consume queued results in order. */
function fakeClient(results: Result[]) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const queue = [...results];
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    eq: () => query,
    select: () => query,
    maybeSingle: () => {
      calls.push({ table: "?", op: "maybeSingle" });
      return Promise.resolve(next());
    },
    single: () => {
      calls.push({ table: "?", op: "single" });
      return Promise.resolve(next());
    },
    then: (onF: unknown, onR: unknown) => {
      calls.push({ table: "?", op: "terminal" });
      return Promise.resolve(next()).then(
        onF as (v: Result) => unknown,
        onR as (e: unknown) => unknown,
      );
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

describe("submit gate", () => {
  it("blocks a fresh attempt with stage and observation requirements", () => {
    const blockers = submitBlockersFor("exp-02", exp02TitrationConfig, toPublicJSON(freshSession()));
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.some((blocker) => blocker.includes("Stage A"))).toBe(true);
    expect(blockers.some((blocker) => blocker.includes("colour change"))).toBe(true);
  });

  it("clears once every stage is concordant, reported and observed", () => {
    const session = concordantFullSession();
    expect(
      recordObservation(session, STAGE_A, "colour_change", "Colourless to persistent faint pink.")
        .ok,
    ).toBe(true);
    expect(
      submitBlockersFor("exp-02", exp02TitrationConfig, toPublicJSON(session)),
    ).toEqual([]);
  });
});

describe("report repositories (offline fake)", () => {
  const sections = {
    aim: "Standardise NaOH.",
    procedure: "Titrate KHP, then HCl.",
    resultsSummary: "NaOH 0.2 M.",
    conclusion: "Standardised.",
    safetyNotes: "Goggles on.",
  };

  it("reads the report row, or null when the student has not started one", async () => {
    const row = {
      id: "111e4567-e89b-12d3-a456-426614174000",
      attempt_id: ATTEMPT_ID,
      status: "draft",
      aim: "a",
      procedure: "p",
      results_summary: "r",
      conclusion: "c",
      safety_notes: "s",
      readings_snapshot: {},
      submitted_at: null,
    };
    const { client } = fakeClient([ok(row)]);
    const report = await getReportForAttempt(client, ATTEMPT_ID);
    expect(report?.resultsSummary).toBe("r");
    expect(report?.submittedAt).toBeNull();

    const { client: empty } = fakeClient([ok(null)]);
    expect(await getReportForAttempt(empty, ATTEMPT_ID)).toBeNull();
  });

  it("saves drafts as drafts without a submission timestamp", async () => {
    const { client, calls } = fakeClient([ok([])]);
    await upsertReportDraft(client, ATTEMPT_ID, sections);
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.table).toBe("reports");
    const payload = upsert?.payload as { payload: Record<string, unknown>; opts: unknown };
    expect(payload.payload).toMatchObject({ attempt_id: ATTEMPT_ID, status: "draft" });
    expect(payload.payload).not.toHaveProperty("submitted_at");
    expect(payload.opts).toMatchObject({ onConflict: "attempt_id" });
  });

  it("freezes the report with the readings snapshot and a submission time", async () => {
    const { client, calls } = fakeClient([ok([])]);
    await submitReportForAttempt(client, ATTEMPT_ID, sections, { schemaVersion: 1 });
    const upsert = calls.find((c) => c.op === "upsert");
    const payload = upsert?.payload as { payload: Record<string, unknown> };
    expect(payload.payload).toMatchObject({
      attempt_id: ATTEMPT_ID,
      status: "submitted",
      readings_snapshot: { schemaVersion: 1 },
    });
    expect(typeof payload.payload.submitted_at).toBe("string");
  });

  it("marks the attempt submitted with only the permitted columns", async () => {
    const row = {
      id: ATTEMPT_ID,
      experiment_id: "exp-02",
      student_id: "222e4567-e89b-12d3-a456-426614174000",
      status: "submitted",
      config_version: 1,
      started_at: "2026-09-01T00:00:00.000Z",
      last_activity_at: "2026-09-17T00:00:00.000Z",
      submitted_at: "2026-09-17T00:00:00.000Z",
      completed_at: null,
      final_score: null,
    };
    const { client, calls } = fakeClient([ok(row)]);
    const attempt = await markAttemptSubmitted(client, ATTEMPT_ID);
    expect(attempt.status).toBe("submitted");
    const update = calls.find((c) => c.op === "update");
    expect(update?.table).toBe("experiment_attempts");
    expect(Object.keys((update?.payload ?? {}) as object).sort()).toEqual([
      "last_activity_at",
      "status",
      "submitted_at",
    ]);
  });
});
