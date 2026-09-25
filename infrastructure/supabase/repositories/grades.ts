import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Grade + answer-key persistence.
 *
 * SECURITY BOUNDARY — read carefully:
 *
 * - `getGradeForAttempt` runs with the student's own client and returns only
 *   the student-visible projection (scores, breakdown, decision). The answer
 *   key (`expected_value`, `tolerance`) is excluded by the column-level SELECT
 *   grant, so it cannot leak even through this function.
 * - `upsertAutoGradeAdmin` and `markCalculationsGradedAdmin` take a
 *   SERVICE-ROLE client (RLS bypass) and must only be called from
 *   server-side grading, never with request-derived values. They write the
 *   assessment outcome the domain engine computed from hidden truth.
 */

const gradeRowSchema = z.object({
  id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  auto_score: z.number().nullable(),
  instructor_score: z.number().nullable(),
  final_score: z.number().nullable(),
  rubric_breakdown: z.record(z.string(), z.unknown()),
  decision: z.enum(["pending", "approved", "returned", "needs_revision"]),
  graded_at: z.string().nullable(),
});

export interface AttemptGrade {
  id: string;
  attemptId: string;
  autoScore: number | null;
  instructorScore: number | null;
  finalScore: number | null;
  rubricBreakdown: Record<string, unknown>;
  decision: "pending" | "approved" | "returned" | "needs_revision";
  gradedAt: string | null;
}

/** The grade outcome for an attempt, if the assessment engine has run. */
export async function getGradeForAttempt(
  client: SupabaseClient,
  attemptId: string,
): Promise<AttemptGrade | null> {
  const { data, error } = await client
    .from("grades")
    .select(
      "id, attempt_id, auto_score, instructor_score, final_score, " +
        "rubric_breakdown, decision, graded_at",
    )
    .eq("attempt_id", attemptId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load grade for attempt ${attemptId}: ${error.message}`);
  if (!data) return null;
  const row = gradeRowSchema.parse(data);
  return {
    id: row.id,
    attemptId: row.attempt_id,
    autoScore: row.auto_score,
    instructorScore: row.instructor_score,
    finalScore: row.final_score,
    rubricBreakdown: { ...row.rubric_breakdown },
    decision: row.decision,
    gradedAt: row.graded_at,
  };
}

export interface AutoGradeResult {
  /** 0–100, two decimals. */
  autoScore: number;
  /** Per-category awarded/max plus question results. No hidden values. */
  breakdown: Record<string, unknown>;
}

/**
 * Persists the automatic assessment for an attempt (service-role only). The
 * row stays `decision = 'pending'` with no grader until an instructor
 * reviews it, satisfying the grades table constraints. Upsert, so a retried
 * submission converges on the same row.
 */
export async function upsertAutoGradeAdmin(
  adminClient: SupabaseClient,
  attemptId: string,
  result: AutoGradeResult,
): Promise<void> {
  const { error } = await adminClient.from("grades").upsert(
    {
      attempt_id: attemptId,
      auto_score: result.autoScore,
      rubric_breakdown: result.breakdown,
      decision: "pending",
    },
    { onConflict: "attempt_id" },
  );

  if (error) throw new Error(`Failed to save automatic grade for attempt ${attemptId}: ${error.message}`);
}

export interface GradedCalculation {
  questionKey: string;
  expectedValue: number;
  tolerance: number;
  correct: boolean;
}

export interface CalculationVerdict {
  questionKey: string;
  correct: boolean | null;
}

/**
 * Student-visible calculation verdicts for an attempt. Only the boolean is
 * selected — the answer key columns stay unreadable by grant design.
 */
export async function listCalculationVerdicts(
  client: SupabaseClient,
  attemptId: string,
): Promise<CalculationVerdict[]> {
  const { data, error } = await client
    .from("calculation_submissions")
    .select("question_key, is_correct")
    .eq("attempt_id", attemptId);

  if (error) throw new Error(`Failed to load calculation verdicts for attempt ${attemptId}: ${error.message}`);
  const rows = z.array(z.object({ question_key: z.string(), is_correct: z.boolean().nullable() })).parse(data);
  return rows.map((row) => ({ questionKey: row.question_key, correct: row.is_correct }));
}

export interface InstructorFeedbackItem {
  id: string;
  category: string;
  body: string;
}

/** Instructor feedback on an attempt, newest last. Student read-only. */
export async function listFeedbackForAttempt(
  client: SupabaseClient,
  attemptId: string,
): Promise<InstructorFeedbackItem[]> {
  const { data, error } = await client
    .from("instructor_feedback")
    .select("id, category, body")
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load feedback for attempt ${attemptId}: ${error.message}`);
  const rows = z
    .array(z.object({ id: z.string().uuid(), category: z.string(), body: z.string() }))
    .parse(data);
  return rows.map((row) => ({ id: row.id, category: row.category, body: row.body }));
}

/**
 * Writes the answer key verdicts for graded calculations (service-role
 * only). The student SELECT grant excludes these columns, so the key never
 * reaches the browser; the student sees only the `is_correct` boolean.
 */
export async function markCalculationsGradedAdmin(
  adminClient: SupabaseClient,
  attemptId: string,
  rows: GradedCalculation[],
): Promise<void> {
  for (const row of rows) {
    const { error } = await adminClient
      .from("calculation_submissions")
      .update({
        expected_value: row.expectedValue,
        tolerance: row.tolerance,
        is_correct: row.correct,
      })
      .eq("attempt_id", attemptId)
      .eq("question_key", row.questionKey);

    if (error) {
      throw new Error(
        `Failed to mark calculation ${row.questionKey} graded for attempt ${attemptId}: ${error.message}`,
      );
    }
  }
}
