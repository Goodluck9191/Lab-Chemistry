import "server-only";
import { requireStudent } from "@/application/auth/dal";
import { getExperimentBriefing } from "@/infrastructure/supabase/repositories/experiments";
import { startOrResumeAttempt } from "@/infrastructure/supabase/repositories/attempts";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { titrationConfigForExperiment } from "@/domain/experiments/catalog/titration-registry";
import { experimentIdSchema } from "./schemas";
import { initialiseTitrationAttempt } from "./apply-simulation-action";

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
 * Phase 3: fresh titration attempts also get their hidden reality (seed +
 * `attempt_secrets`) and an initialised engine snapshot. Resumed attempts are
 * untouched — their secrets and snapshot already exist (or are lazily
 * initialised on first action for pre-Phase-3 attempts).
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

  if (!resumed) {
    const titrationConfig = titrationConfigForExperiment(experimentId);
    if (titrationConfig) {
      await initialiseTitrationAttempt(attempt.id, titrationConfig);
    }
  }

  return { attemptId: attempt.id, experimentId, resumed };
}
