import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  appendMeasurementRows,
  getAttemptRevision,
  RevisionConflictError,
  saveSnapshotConditional,
  syncCalculationRows,
  syncTrialRows,
} from "@/infrastructure/supabase/repositories/attempts";
import { createInitialSimulationState } from "@/domain/simulation";
import type { SupabaseClient } from "@supabase/supabase-js";

type Result = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message: string): Result => ({ data: null, error: { message } });

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

describe("persistence repositories (offline fake)", () => {
  it("saves the snapshot on a revision match and returns the next revision", async () => {
    const { client, calls } = fakeClient([ok([{ revision: 4 }])]);
    const revision = await saveSnapshotConditional(
      client,
      ATTEMPT_ID,
      3,
      createInitialSimulationState(),
    );
    expect(revision).toBe(4);
    const update = calls.find((c) => c.op === "update");
    expect(update?.table).toBe("attempt_state");
    expect(update?.payload).toMatchObject({ revision: 4 });
  });

  it("throws RevisionConflictError when the row moved underneath the client", async () => {
    const { client } = fakeClient([ok([])]);
    await expect(
      saveSnapshotConditional(client, ATTEMPT_ID, 3, createInitialSimulationState()),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("surfaces database errors instead of misreporting them as conflicts", async () => {
    const { client } = fakeClient([fail("connection lost")]);
    await expect(
      saveSnapshotConditional(client, ATTEMPT_ID, 3, createInitialSimulationState()),
    ).rejects.toThrow("connection lost");
  });

  it("reads the revision, defaulting to 0 without a state row", async () => {
    const { client } = fakeClient([ok({ revision: 7 })]);
    expect(await getAttemptRevision(client, ATTEMPT_ID)).toBe(7);
    const { client: empty } = fakeClient([ok(null)]);
    expect(await getAttemptRevision(empty, ATTEMPT_ID)).toBe(0);
  });

  it("upserts trial rows and resolves ids by trial number", async () => {
    const { client, calls } = fakeClient([
      ok([]),
      ok([{ id: "trial-uuid-1", trial_number: 1 }]),
    ]);
    const ids = await syncTrialRows(client, ATTEMPT_ID, [
      {
        trialNumber: 1,
        status: "recorded",
        initialReading: 0,
        finalReading: 14.5,
        titreVolume: 14.5,
        endpointObserved: true,
        rejectionReason: null,
      },
    ]);
    expect(ids.get(1)).toBe("trial-uuid-1");
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.table).toBe("experiment_trials");
  });

  it("appends only measurements whose label is not stored yet", async () => {
    const existing = "stage-a trial 1 initial burette reading";
    const { client, calls } = fakeClient([ok([{ label: existing }]), ok([])]);
    const appended = await appendMeasurementRows(
      client,
      ATTEMPT_ID,
      new Map([[1, "trial-uuid-1"]]),
      [
        { kind: "titration_reading", label: existing, value: 0, unit: "mL", trialRowNumber: 1 },
        { kind: "titration_reading", label: "stage-a trial 1 final burette reading", value: 14.5, unit: "mL", trialRowNumber: 1 },
      ],
    );
    expect(appended).toBe(1);
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("measurements");
    const rows = (insert?.payload ?? []) as Array<{ label: string; trial_id: string }>;
    expect(rows.map((r) => r.label)).toEqual(["stage-a trial 1 final burette reading"]);
    expect(rows[0].trial_id).toBe("trial-uuid-1");
  });

  it("writes only student-controlled calculation columns", async () => {
    const { client, calls } = fakeClient([ok([])]);
    await syncCalculationRows(client, ATTEMPT_ID, [
      { questionKey: "q", studentValue: 0.2, studentUnit: "mol/L", attemptNumber: 1 },
    ]);
    const upsert = calls.find((c) => c.op === "upsert");
    const payload = upsert?.payload as { payload: Array<Record<string, unknown>> };
    const keys = Object.keys(payload.payload[0]).sort();
    expect(keys).toEqual(["attempt_id", "attempt_number", "question_key", "student_unit", "student_value"]);
  });
});
