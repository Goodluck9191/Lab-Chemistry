import "server-only";
import { requireStudent } from "@/application/auth/dal";
import { getAttemptWithState } from "@/infrastructure/supabase/repositories/attempts";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { canWriteAttemptData } from "@/application/auth/access";
import type { ExperimentAttempt } from "@/domain/attempts";
import type { SimulationState } from "@/domain/simulation/types";
import { attemptIdSchema } from "./schemas";

export interface StudentAttemptView {
  attempt: ExperimentAttempt;
  state: SimulationState;
  /** Whether the student may still change anything about this attempt. */
  canWrite: boolean;
}

/**
 * Use case: load one of the signed-in student's own attempts.
 *
 * Two independent guards apply. RLS already refuses to return another student's
 * row, and `canWriteAttemptData` states the rule explicitly so a regression in
 * either layer is caught by the tests.
 */
export async function getStudentAttempt(attemptId: string): Promise<StudentAttemptView | null> {
  const id = attemptIdSchema.parse(attemptId);
  const { user, profile } = await requireStudent();

  const supabase = await createServerSupabaseClient();
  const result = await getAttemptWithState(supabase, id);
  if (!result) return null;

  const canWrite = canWriteAttemptData({
    role: profile.role,
    userId: user.id,
    attemptStudentId: result.attempt.studentId,
    status: result.attempt.status,
  });

  if (result.attempt.studentId !== user.id) {
    // Defensive: RLS should have prevented this. Fail closed and loudly.
    throw new Error(`Attempt ${id} does not belong to the signed-in student`);
  }

  return { attempt: result.attempt, state: result.state, canWrite };
}
