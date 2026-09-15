import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTEMPT_STATUSES, type AttemptSummary, type ExperimentAttempt } from "@/domain/attempts";
import { createInitialSimulationState, simulationStateSchema } from "@/domain/simulation";
import type { SimulationState } from "@/domain/simulation/types";

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
