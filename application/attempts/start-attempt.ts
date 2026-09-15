import "server-only";
import { requireStudent } from "@/application/auth/dal";
import { getExperimentBriefing } from "@/infrastructure/supabase/repositories/experiments";
import { startOrResumeAttempt } from "@/infrastructure/supabase/repositories/attempts";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { experimentIdSchema } from "./schemas";

export class ExperimentNotFoundError extends Error {
  constructor(experimentId: string) {
    super(`Experiment ${experimentId} is not available`);
    this.name = "ExperimentNotFoundError";
  }
}

export interface StartAttemptResult {
  attemptId: string;
  experimentId: string;
  /** True when an in-progress attempt already existed and was reopened. */
  resumed: boolean;
}

/**
 * Use case: start (or resume) an attempt at an experiment.
 *
 * Stage 1 deliberately stops here. Generating the hidden per-attempt parameters,
 * initialising the simulation and creating `attempt_secrets` belongs to the
 * simulation stage; the database and the domain contracts for that already
 * exist, so the shape will not change.
 */
export async function startAttempt(rawInput: { experimentId: string }): Promise<StartAttemptResult> {
  const { experimentId } = { experimentId: experimentIdSchema.parse(rawInput.experimentId) };
  const { user, profile } = await requireStudent(`/lab/${experimentId}`);

  const supabase = await createServerSupabaseClient();

  const experiment = await getExperimentBriefing(supabase, experimentId);
  if (!experiment) throw new ExperimentNotFoundError(experimentId);

  const { attempt, resumed } = await startOrResumeAttempt(supabase, {
    studentId: profile.id,
    experimentId,
    configVersion: experiment.configVersion,
  });

  // `user` is intentionally part of the check above: an attempt is only ever
  // created for the authenticated student, never for an id supplied by a client.
  void user;

  return { attemptId: attempt.id, experimentId, resumed };
}
