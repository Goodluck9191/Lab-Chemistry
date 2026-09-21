import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  appendMeasurementRows,
  getAttemptRevision,
  RevisionConflictError,
  saveSnapshotConditional,
  syncCalculationRows,
  syncObservationRows,
  syncTrialRows,
  submitReportForAttempt,
  upsertReportDraft,
} from "@/infrastructure/supabase/repositories/attempts";
import { createInitialSimulationState } from "@/domain/simulation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPrivilegeCheckingClient } from "../helpers/postgrest-privilege-fake";

type Result = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message: string): Result => ({ data: null, error: { message } });

interface StubCall {
  table: string;
  op: string;
  payload?: unknown;
  options?: { onConflict?: string; ignoreDuplicates?: boolean };
  filters: Array<[string, unknown]>;
}

/** Minimal chainable stub: terminal awaits consume queued results in order. */
function fakeClient(results: Result[]) {
  const calls: StubCall[] = [];
  const queue = [...results];
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  let current: StubCall | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    eq: (column: string, value: unknown) => {
      current?.filters.push([column, value]);
      return query;
    },
    select: () => query,
    maybeSingle: () => {
      calls.push({ table: "?", op: "maybeSingle", filters: [] });
      return Promise.resolve(next());
    },
    then: (onF: unknown, onR: unknown) => {
      calls.push({ table: "?", op: "terminal", filters: [] });
      return Promise.resolve(next()).then(
        onF as (v: Result) => unknown,
        onR as (e: unknown) => unknown,
      );
    },
  };
  const client = {
    from: (table: string) => ({
      update: (payload: unknown) => {
        current = { table, op: "update", payload, filters: [] };
        calls.push(current);
        return query;
      },
      insert: (payload: unknown) => {
        current = { table, op: "insert", payload, filters: [] };
        calls.push(current);
        return query;
      },
      upsert: (payload: unknown, options?: StubCall["options"]) => {
        current = { table, op: "upsert", payload, options, filters: [] };
        calls.push(current);
        return query;
      },
      select: () => {
        current = { table, op: "select", filters: [] };
        calls.push(current);
        return query;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ATTEMPT_ID = "123e4567-e89b-12d3-a456-426614174000";

const trialRow = {
  trialNumber: 1,
  stageKey: "stage-a-khp-naoh",
  status: "recorded" as const,
  initialReading: 0,
  finalReading: 14.5,
  titreVolume: 14.5,
  endpointObserved: true,
  rejectionReason: null,
};

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
});

/**
 * The write pattern is tested against the database's COLUMN-LEVEL GRANTS rather
 * than a permissive stub. `resolution=merge-duplicates` is refused here because
 * PostgreSQL requires UPDATE privilege on every column of the generated
 * `DO UPDATE SET` — identity columns included — which is what made the first
 * trial write of an attempt fail in production.
 */
describe("projection writes against the real column grants", () => {
  it("writes trial rows without ever asking to update their identity", async () => {
    const { client, calls, rows } = createPrivilegeCheckingClient();

    const ids = await syncTrialRows(client, ATTEMPT_ID, [trialRow]);

    const upsert = calls.find((call) => call.table === "experiment_trials" && call.op === "upsert");
    expect(upsert?.mergeDuplicates).toBe(false);
    const update = calls.find((call) => call.table === "experiment_trials" && call.op === "update");
    expect(update?.columns.sort()).toEqual([
      "endpoint_observed",
      "final_reading",
      "initial_reading",
      "rejection_reason",
      "status",
      "titre_volume",
    ]);
    expect(update?.filters).toEqual({ attempt_id: ATTEMPT_ID, trial_number: 1 });
    expect(rows("experiment_trials")).toHaveLength(1);
    expect(ids.size).toBe(1);
  });

  it("converges on one row per key when the same action is replayed", async () => {
    const { client, rows } = createPrivilegeCheckingClient();

    await syncTrialRows(client, ATTEMPT_ID, [trialRow]);
    await syncTrialRows(client, ATTEMPT_ID, [
      { ...trialRow, status: "rejected", rejectionReason: "endpoint overshot" },
    ]);

    const stored = rows("experiment_trials");
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("rejected");
    expect(stored[0].rejection_reason).toBe("endpoint overshot");
    expect(stored[0].stage_key).toBe("stage-a-khp-naoh");
  });

  it("records a stage-accurate trial number without colliding with the next stage", async () => {
    const { client, rows } = createPrivilegeCheckingClient();

    await syncTrialRows(client, ATTEMPT_ID, [
      { ...trialRow, trialNumber: 1 },
      { ...trialRow, trialNumber: 11, stageKey: "stage-b-hcl-naoh" },
    ]);

    expect(rows("experiment_trials").map((row) => row.trial_number).sort()).toEqual([1, 11]);
  });

  it("patches observations by (attempt, step, field) and only their values", async () => {
    const { client, calls, rows } = createPrivilegeCheckingClient();

    await syncObservationRows(client, ATTEMPT_ID, new Map(), [
      {
        stepKey: "stage-a-khp-naoh",
        fieldKey: "trial_1_endpoint_colour",
        textValue: null,
        choiceValue: "faint_pink",
        trialRowNumber: null,
      },
    ]);
    await syncObservationRows(client, ATTEMPT_ID, new Map(), [
      {
        stepKey: "stage-a-khp-naoh",
        fieldKey: "trial_1_endpoint_colour",
        textValue: null,
        choiceValue: "colourless",
        trialRowNumber: null,
      },
    ]);

    const update = calls.find((call) => call.table === "observations" && call.op === "update");
    expect(update?.columns.sort()).toEqual(["choice_value", "text_value"]);
    expect(update?.filters).toEqual({
      attempt_id: ATTEMPT_ID,
      step_key: "stage-a-khp-naoh",
      field_key: "trial_1_endpoint_colour",
    });
    expect(rows("observations")).toHaveLength(1);
    expect(rows("observations")[0].choice_value).toBe("colourless");
  });

  it("writes only student-controlled calculation columns", async () => {
    const { client, calls } = createPrivilegeCheckingClient();

    await syncCalculationRows(client, ATTEMPT_ID, [
      { questionKey: "q", studentValue: 0.2, studentUnit: "mol/L", attemptNumber: 1 },
    ]);

    const upsert = calls.find((call) => call.table === "calculation_submissions" && call.op === "upsert");
    expect(upsert?.columns.sort()).toEqual([
      "attempt_id",
      "attempt_number",
      "question_key",
      "student_unit",
      "student_value",
    ]);
    // INSERT only: the identity columns are never named in an UPDATE.
    expect(upsert?.mergeDuplicates).toBe(false);
    const update = calls.find((call) => call.table === "calculation_submissions" && call.op === "update");
    expect(update?.columns.sort()).toEqual(["attempt_number", "student_unit", "student_value"]);
    expect(update?.filters).toEqual({ attempt_id: ATTEMPT_ID, question_key: "q" });
  });

  it("saves and freezes a report without updating its attempt_id", async () => {
    const { client, calls, rows } = createPrivilegeCheckingClient();
    const sections = {
      aim: "a",
      procedure: "p",
      resultsSummary: "r",
      conclusion: "c",
      safetyNotes: "s",
    };

    await upsertReportDraft(client, ATTEMPT_ID, sections);
    await submitReportForAttempt(client, ATTEMPT_ID, sections, { readings: [] });

    const updates = calls.filter((call) => call.table === "reports" && call.op === "update");
    expect(updates).toHaveLength(2);
    for (const call of updates) expect(call.columns).not.toContain("attempt_id");
    expect(rows("reports")).toHaveLength(1);
    expect(rows("reports")[0].status).toBe("submitted");
  });

  it("would refuse the old merge-duplicates upsert, which is why the pattern changed", async () => {
    const { client } = createPrivilegeCheckingClient();

    // The historical implementation, kept here as the reason for the current one.
    await expect(
      client.from("experiment_trials").upsert(
        {
          attempt_id: ATTEMPT_ID,
          trial_number: 1,
          status: "open",
          stage_key: "stage-a-khp-naoh",
        },
        { onConflict: "attempt_id,trial_number" },
      ),
    ).rejects.toThrow(/permission denied for table experiment_trials/);
  });
});
