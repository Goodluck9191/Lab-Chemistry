import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTEMPT_STATUSES, type AttemptSummary, type ExperimentAttempt } from "@/domain/attempts";
import { createInitialSimulationState, simulationStateSchema } from "@/domain/simulation";
import type { SimulationState } from "@/domain/simulation/types";
import type { AttemptSecrets } from "@/domain/simulation/secrets";
import type {
  CalculationRow,
  MeasurementRow,
  ObservationRow,
  TrialRow,
} from "@/domain/simulation/titration/persistence";

export const ATTEMPT_COLUMNS =
  "id, experiment_id, student_id, status, config_version, started_at, last_activity_at, " +
  "submitted_at, completed_at, final_score";

const attemptRowSchema = z.object({
  id: z.string().uuid(),
  experiment_id: z.string(),
  student_id: z.string().uuid(),
  status: z.enum(ATTEMPT_STATUSES),
  config_version: z.number().int(),
  started_at: z.string(),
  last_activity_at: z.string(),
  submitted_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  final_score: z.number().nullable(),
});

type AttemptRow = z.infer<typeof attemptRowSchema>;

function mapAttemptRow(row: AttemptRow): ExperimentAttempt {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    studentId: row.student_id,
    status: row.status,
    configVersion: row.config_version,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    finalScore: row.final_score,
  };
}

/** RLS limits this to the signed-in student's own attempts. */
export async function listAttemptsForStudent(
  client: SupabaseClient,
  studentId: string,
): Promise<AttemptSummary[]> {
  const { data, error } = await client
    .from("experiment_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("student_id", studentId)
    .order("last_activity_at", { ascending: false });

  if (error) throw new Error(`Failed to list attempts: ${error.message}`);

  const attempts = z.array(attemptRowSchema).parse(data ?? []);
  if (attempts.length === 0) return [];

  const experimentIds = [...new Set(attempts.map((row) => row.experiment_id))];
  const { data: experiments, error: experimentError } = await client
    .from("experiments")
    .select("id, title, experiment_number")
    .in("id", experimentIds);

  if (experimentError) throw new Error(`Failed to load attempt experiments: ${experimentError.message}`);

  const byId = new Map(
    z
      .array(z.object({ id: z.string(), title: z.string(), experiment_number: z.number().int() }))
      .parse(experiments ?? [])
      .map((row) => [row.id, row]),
  );

  return attempts.map((row) => ({
    ...mapAttemptRow(row),
    experimentTitle: byId.get(row.experiment_id)?.title ?? "Unknown experiment",
    experimentNumber: byId.get(row.experiment_id)?.experiment_number ?? 0,
  }));
}

export async function findActiveAttempt(
  client: SupabaseClient,
  studentId: string,
  experimentId: string,
): Promise<ExperimentAttempt | null> {
  const { data, error } = await client
    .from("experiment_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("student_id", studentId)
    .eq("experiment_id", experimentId)
    .eq("status", "in_progress")
    .maybeSingle();

  if (error) throw new Error(`Failed to look up an active attempt: ${error.message}`);
  if (!data) return null;

  return mapAttemptRow(attemptRowSchema.parse(data));
}

/**
 * Starts an attempt, or resumes the one already open for this experiment.
 *
 * The database enforces "one in-progress attempt per student per experiment"
 * with a partial unique index, so a double-click cannot create two. That
 * constraint violation (23505) is treated as "resume", not as an error.
 */
export async function startOrResumeAttempt(
  client: SupabaseClient,
  input: { studentId: string; experimentId: string; configVersion: number },
): Promise<{ attempt: ExperimentAttempt; resumed: boolean }> {
  const existing = await findActiveAttempt(client, input.studentId, input.experimentId);
  if (existing) return { attempt: existing, resumed: true };

  const { data, error } = await client
    .from("experiment_attempts")
    .insert({
      student_id: input.studentId,
      experiment_id: input.experimentId,
      config_version: input.configVersion,
      status: "in_progress",
    })
    .select(ATTEMPT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      const raced = await findActiveAttempt(client, input.studentId, input.experimentId);
      if (raced) return { attempt: raced, resumed: true };
    }
    throw new Error(`Failed to start attempt: ${error.message}`);
  }

  const attempt = mapAttemptRow(attemptRowSchema.parse(data));

  const { error: stateError } = await client
    .from("attempt_state")
    .insert({ attempt_id: attempt.id, snapshot: createInitialSimulationState() });

  if (stateError) {
    throw new Error(`Attempt ${attempt.id} was created without initial state: ${stateError.message}`);
  }

  return { attempt, resumed: false };
}

export async function getAttemptWithState(
  client: SupabaseClient,
  attemptId: string,
): Promise<{ attempt: ExperimentAttempt; state: SimulationState } | null> {
  const { data, error } = await client
    .from("experiment_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load attempt ${attemptId}: ${error.message}`);
  if (!data) return null;

  const attempt = mapAttemptRow(attemptRowSchema.parse(data));

  const { data: stateRow, error: stateError } = await client
    .from("attempt_state")
    .select("snapshot")
    .eq("attempt_id", attemptId)
    .maybeSingle();

  if (stateError) throw new Error(`Failed to load attempt state: ${stateError.message}`);

  const state = stateRow
    ? simulationStateSchema.parse(stateRow.snapshot)
    : createInitialSimulationState();

  return { attempt, state };
}

// ---------------------------------------------------------------------------
// Phase 3: secrets, revisions, row sync
// ---------------------------------------------------------------------------

const attemptSecretsRowSchema = z.object({
  attempt_id: z.string().uuid(),
  seed: z.string().min(1),
  true_values: z.record(z.string(), z.number()),
  expected_endpoint: z.record(z.string(), z.union([z.number(), z.string()])),
  rubric_weights: z.record(z.string(), z.number()),
});

function mapSecretsRow(row: z.infer<typeof attemptSecretsRowSchema>): AttemptSecrets {
  return {
    seed: row.seed,
    trueValues: { ...row.true_values },
    expectedEndpoint: { ...row.expected_endpoint },
    rubricWeights: { ...row.rubric_weights },
  };
}

/**
 * Reads hidden parameters with a service-role client. `attempt_secrets` has
 * zero RLS policies, so this is the ONLY way to read it — never call it with
 * a user-scoped client and never return its result to the browser.
 */
export async function getAttemptSecretsAdmin(
  adminClient: SupabaseClient,
  attemptId: string,
): Promise<AttemptSecrets | null> {
  const { data, error } = await adminClient
    .from("attempt_secrets")
    .select("attempt_id, seed, true_values, expected_endpoint, rubric_weights")
    .eq("attempt_id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load attempt secrets: ${error.message}`);
  if (!data) return null;
  return mapSecretsRow(attemptSecretsRowSchema.parse(data));
}

/** Writes hidden parameters (insert or replace) with a service-role client. */
export async function saveAttemptSecretsAdmin(
  adminClient: SupabaseClient,
  attemptId: string,
  secrets: AttemptSecrets,
): Promise<void> {
  const { error } = await adminClient.from("attempt_secrets").upsert(
    {
      attempt_id: attemptId,
      seed: secrets.seed,
      true_values: secrets.trueValues,
      expected_endpoint: secrets.expectedEndpoint,
      rubric_weights: secrets.rubricWeights,
    },
    { onConflict: "attempt_id" },
  );

  if (error) throw new Error(`Failed to save attempt secrets: ${error.message}`);
}

export class RevisionConflictError extends Error {
  readonly attemptId: string;
  readonly baseRevision: number;
  constructor(attemptId: string, baseRevision: number) {
    super(
      `Attempt ${attemptId} changed since revision ${baseRevision}: refetch and retry the action`,
    );
    this.name = "RevisionConflictError";
    this.attemptId = attemptId;
    this.baseRevision = baseRevision;
  }
}

/** Current autosave revision of an attempt (0 when no state row exists yet). */
export async function getAttemptRevision(
  client: SupabaseClient,
  attemptId: string,
): Promise<number> {
  const { data, error } = await client
    .from("attempt_state")
    .select("revision")
    .eq("attempt_id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load attempt revision: ${error.message}`);
  if (!data) return 0;
  return z.object({ revision: z.number().int().min(0) }).parse(data).revision;
}

export async function getAttemptWithStateAndRevision(
  client: SupabaseClient,
  attemptId: string,
): Promise<{ attempt: ExperimentAttempt; state: SimulationState; revision: number } | null> {
  const result = await getAttemptWithState(client, attemptId);
  if (!result) return null;
  const revision = await getAttemptRevision(client, attemptId);
  return { ...result, revision };
}

/**
 * Autosave write with optimistic concurrency: the snapshot is stored only if
 * the row is still at `baseRevision`, then revision becomes baseRevision + 1.
 * A stale client gets `RevisionConflictError` and must refetch (resume) and
 * re-issue its action — its data is never silently overwritten.
 */
export async function saveSnapshotConditional(
  client: SupabaseClient,
  attemptId: string,
  baseRevision: number,
  snapshot: SimulationState,
): Promise<number> {
  const parsed = simulationStateSchema.parse(snapshot);
  const nextRevision = baseRevision + 1;

  const { data, error } = await client
    .from("attempt_state")
    .update({ revision: nextRevision, snapshot: parsed })
    .eq("attempt_id", attemptId)
    .eq("revision", baseRevision)
    .select("revision");

  if (error) throw new Error(`Failed to save attempt state: ${error.message}`);
  if (!data || data.length === 0) {
    throw new RevisionConflictError(attemptId, baseRevision);
  }
  return nextRevision;
}

/** Upserts trial projection rows (insert or replace by attempt + number). */
export async function syncTrialRows(
  client: SupabaseClient,
  attemptId: string,
  rows: TrialRow[],
): Promise<Map<number, string>> {
  const idsByNumber = new Map<number, string>();
  if (rows.length === 0) return idsByNumber;

  const { error } = await client.from("experiment_trials").upsert(
    rows.map((row) => ({
      attempt_id: attemptId,
      trial_number: row.trialNumber,
      stage_key: row.stageKey,
      status: row.status,
      initial_reading: row.initialReading,
      final_reading: row.finalReading,
      titre_volume: row.titreVolume,
      endpoint_observed: row.endpointObserved,
      rejection_reason: row.rejectionReason,
    })),
    { onConflict: "attempt_id,trial_number" },
  );

  if (error) throw new Error(`Failed to sync trial rows: ${error.message}`);

  const { data, error: selectError } = await client
    .from("experiment_trials")
    .select("id, trial_number")
    .eq("attempt_id", attemptId);

  if (selectError) throw new Error(`Failed to load trial ids: ${selectError.message}`);
  for (const row of z.array(z.object({ id: z.string(), trial_number: z.number() })).parse(data ?? [])) {
    idsByNumber.set(row.trial_number, row.id);
  }
  return idsByNumber;
}

/** Labels already stored, so autosave retries never duplicate history rows. */
export async function listMeasurementLabels(
  client: SupabaseClient,
  attemptId: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("measurements")
    .select("label")
    .eq("attempt_id", attemptId);

  if (error) throw new Error(`Failed to list measurements: ${error.message}`);
  return new Set(
    z.array(z.object({ label: z.string() })).parse(data ?? []).map((row) => row.label),
  );
}

/**
 * Appends only measurement rows whose deterministic label is not stored yet.
 * Measurements are append-only by schema (no UPDATE grant), so idempotency
 * comes from label comparison, not from overwriting.
 */
export async function appendMeasurementRows(
  client: SupabaseClient,
  attemptId: string,
  trialIdsByNumber: Map<number, string>,
  rows: MeasurementRow[],
): Promise<number> {
  const existing = await listMeasurementLabels(client, attemptId);
  const fresh = rows.filter((row) => !existing.has(row.label));
  if (fresh.length === 0) return 0;

  const { error } = await client.from("measurements").insert(
    fresh.map((row) => ({
      attempt_id: attemptId,
      trial_id: row.trialRowNumber === null ? null : (trialIdsByNumber.get(row.trialRowNumber) ?? null),
      kind: row.kind,
      label: row.label,
      value: row.value,
      unit: row.unit,
    })),
  );

  if (error) throw new Error(`Failed to append measurements: ${error.message}`);
  return fresh.length;
}

/** Upserts endpoint/indicator observations by (attempt, step, field). */
export async function syncObservationRows(
  client: SupabaseClient,
  attemptId: string,
  trialIdsByNumber: Map<number, string>,
  rows: Array<ObservationRow & { trialRowNumber: number | null }>,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from("observations").upsert(
    rows.map((row) => ({
      attempt_id: attemptId,
      trial_id:
        row.trialRowNumber === null ? null : (trialIdsByNumber.get(row.trialRowNumber) ?? null),
      step_key: row.stepKey,
      field_key: row.fieldKey,
      text_value: row.textValue,
      choice_value: row.choiceValue,
    })),
    { onConflict: "attempt_id,step_key,field_key" },
  );

  if (error) throw new Error(`Failed to sync observations: ${error.message}`);
}

/**
 * Upserts the student's reported values. Only student-controlled columns are
 * written: the answer key (`expected_value`, `tolerance`, `is_correct`) stays
 * null until server-side grading, which writes it through a privileged path.
 */
export async function syncCalculationRows(
  client: SupabaseClient,
  attemptId: string,
  rows: CalculationRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from("calculation_submissions").upsert(
    rows.map((row) => ({
      attempt_id: attemptId,
      question_key: row.questionKey,
      student_value: row.studentValue,
      student_unit: row.studentUnit,
      attempt_number: row.attemptNumber,
    })),
    { onConflict: "attempt_id,question_key" },
  );

  if (error) throw new Error(`Failed to sync calculations: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Phase 5: report draft + submission
//
// The `reports` row is the student's write-up: five text sections plus a
// frozen copy of the PUBLIC readings used in the submitted report. Only
// student-controlled columns are ever written here; the RLS grants in 0006
// already limit clients to exactly these columns, and `readings_snapshot`
// carries the public projection (never hidden parameters).
// ---------------------------------------------------------------------------

const reportRowSchema = z.object({
  id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  status: z.enum(["draft", "submitted", "reviewed"]),
  aim: z.string(),
  procedure: z.string(),
  results_summary: z.string(),
  conclusion: z.string(),
  safety_notes: z.string(),
  readings_snapshot: z.record(z.string(), z.unknown()),
  submitted_at: z.string().nullable(),
});

export interface ReportSections {
  aim: string;
  procedure: string;
  resultsSummary: string;
  conclusion: string;
  safetyNotes: string;
}

export interface AttemptReport extends ReportSections {
  id: string;
  attemptId: string;
  status: "draft" | "submitted" | "reviewed";
  /** Frozen public readings at submit time. Never sent to the browser. */
  readingsSnapshot: Record<string, unknown>;
  submittedAt: string | null;
}

function mapReportRow(row: z.infer<typeof reportRowSchema>): AttemptReport {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    status: row.status,
    aim: row.aim,
    procedure: row.procedure,
    resultsSummary: row.results_summary,
    conclusion: row.conclusion,
    safetyNotes: row.safety_notes,
    readingsSnapshot: { ...row.readings_snapshot },
    submittedAt: row.submitted_at,
  };
}

/** The student's report row, if one exists. RLS limits this to readable attempts. */
export async function getReportForAttempt(
  client: SupabaseClient,
  attemptId: string,
): Promise<AttemptReport | null> {
  const { data, error } = await client
    .from("reports")
    .select(
      "id, attempt_id, status, aim, procedure, results_summary, conclusion, " +
        "safety_notes, readings_snapshot, submitted_at",
    )
    .eq("attempt_id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load report for attempt ${attemptId}: ${error.message}`);
  if (!data) return null;
  return mapReportRow(reportRowSchema.parse(data));
}

/**
 * Saves the student's write-up as a draft. Only while the attempt is writable:
 * the RLS insert/update policies refuse drafts on a submitted attempt.
 */
export async function upsertReportDraft(
  client: SupabaseClient,
  attemptId: string,
  sections: ReportSections,
): Promise<void> {
  const { error } = await client.from("reports").upsert(
    {
      attempt_id: attemptId,
      status: "draft",
      aim: sections.aim,
      procedure: sections.procedure,
      results_summary: sections.resultsSummary,
      conclusion: sections.conclusion,
      safety_notes: sections.safetyNotes,
    },
    { onConflict: "attempt_id" },
  );

  if (error) throw new Error(`Failed to save report draft: ${error.message}`);
}

/**
 * Freezes the report: submitted status, the student's final sections and a
 * frozen copy of the public readings. Must run BEFORE the attempt itself is
 * marked submitted, because afterwards the RLS write policies no longer match.
 */
export async function submitReportForAttempt(
  client: SupabaseClient,
  attemptId: string,
  sections: ReportSections,
  readingsSnapshot: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from("reports").upsert(
    {
      attempt_id: attemptId,
      status: "submitted",
      aim: sections.aim,
      procedure: sections.procedure,
      results_summary: sections.resultsSummary,
      conclusion: sections.conclusion,
      safety_notes: sections.safetyNotes,
      readings_snapshot: readingsSnapshot,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "attempt_id" },
  );

  if (error) throw new Error(`Failed to submit report: ${error.message}`);
}

/**
 * The single permitted forward transition for a student: in_progress (or a
 * returned rework) -> submitted. The RLS update policy enforces the same
 * transition, so a crafted request cannot jump anywhere else; the row parse
 * confirms what was actually written.
 */
export async function markAttemptSubmitted(
  client: SupabaseClient,
  attemptId: string,
): Promise<ExperimentAttempt> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("experiment_attempts")
    .update({ status: "submitted", submitted_at: now, last_activity_at: now })
    .eq("id", attemptId)
    .select(ATTEMPT_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to submit attempt ${attemptId}: ${error.message}`);
  return mapAttemptRow(attemptRowSchema.parse(data));
}
