import "server-only";
import { randomUUID } from "node:crypto";
import { requireStudent } from "@/application/auth/dal";
import { canWriteAttemptData } from "@/application/auth/access";
import type { AttemptStatus } from "@/domain/attempts";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { createAdminSupabaseClient } from "@/infrastructure/supabase/admin";
import {
  getAttemptSecretsAdmin,
  getAttemptWithStateAndRevision,
  saveAttemptSecretsAdmin,
  saveSnapshotConditional,
  syncCalculationRows,
  syncObservationRows,
  syncTrialRows,
  appendMeasurementRows,
  RevisionConflictError,
} from "@/infrastructure/supabase/repositories/attempts";
import { titrationConfigForExperiment } from "@/domain/experiments/catalog/titration-registry";
import type { TitrationExperimentConfig } from "@/domain/simulation/titration/config";
import {
  createTitrationSession,
  toPublicJSON,
  type TitrationPublicState,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import { observeFlaskColour } from "@/domain/simulation/titration/endpoint";
import {
  measurementRowsFor,
  preparationMeasurementRows,
  solutionMeasurementRows,
  trialRowFor,
  trialRowNumber,
} from "@/domain/simulation/titration/persistence";
import { parseTitrationEnvelope } from "@/domain/simulation/titration/protocol";
import {
  resumeSessionFromSnapshot,
  secretsForStorage,
  snapshotFromSession,
} from "@/domain/simulation/titration/snapshot";
import { attemptIdSchema } from "./schemas";

export { RevisionConflictError };

export interface TitrationActionResult {
  accepted: boolean;
  code: string | null;
  message: string | null;
  /** Revision the client must use as the base for its next action. */
  revision: number;
  /** Safe-to-render session projection. Never contains hidden values. */
  public: TitrationPublicState;
  /** Colour the student sees after this action (delivery/observation only). */
  colour: string | null;
  /** Whether a reported molarity matched (never the expected value). */
  calculationCorrect: boolean | null;
}


export interface LoadedTitrationAttempt {
  attemptId: string;
  experimentId: string;
  status: AttemptStatus;
  config: TitrationExperimentConfig;
  session: TitrationSession;
  revision: number;
  canWrite: boolean;
}

/**
 * Load a titration attempt for the signed-in student: RLS-scoped attempt and
 * snapshot, ownership + writable-status checks, hidden state from the
 * service-role client, engine session resumed. Throws when the attempt does
 * not exist, belongs to someone else, is frozen, or has no titration config.
 */
export async function loadTitrationAttempt(attemptId: string): Promise<LoadedTitrationAttempt> {
  const id = attemptIdSchema.parse(attemptId);
  const { user, profile } = await requireStudent();
  const supabase = await createServerSupabaseClient();

  const stored = await getAttemptWithStateAndRevision(supabase, id);
  if (!stored) throw new Error(`Attempt ${id} was not found`);

  if (stored.attempt.studentId !== user.id) {
    throw new Error(`Attempt ${id} does not belong to the signed-in student`);
  }

  const canWrite = canWriteAttemptData({
    role: profile.role,
    userId: user.id,
    attemptStudentId: stored.attempt.studentId,
    status: stored.attempt.status,
  });

  const config = titrationConfigForExperiment(stored.attempt.experimentId);
  if (!config) throw new Error(`Experiment ${stored.attempt.experimentId} is not a titration simulation`);

  const admin = createAdminSupabaseClient();
  let secrets = await getAttemptSecretsAdmin(admin, id);
  if (!secrets) {
    // Attempts created before Phase 3 (or raced with init) have no secrets
    // yet: lazily initialise them now so resume always works.
    secrets = await initialiseTitrationAttempt(id, config);
  }

  const session = resumeSessionFromSnapshot(config, secrets, stored.state);
  return {
    attemptId: id,
    experimentId: stored.attempt.experimentId,
    status: stored.attempt.status,
    config,
    session,
    revision: stored.revision,
    canWrite,
  };
}

/**
 * Initialise the hidden reality + starting snapshot for a fresh attempt.
 * Idempotent only in the sense that callers check for existing secrets first;
 * the admin upsert makes a double-run converge on the latest write.
 */
export async function initialiseTitrationAttempt(
  attemptId: string,
  config: TitrationExperimentConfig,
) {
  const seed = randomUUID();
  const session = createTitrationSession(config, seed);
  const secrets = secretsForStorage(seed, session);
  const admin = createAdminSupabaseClient();
  await saveAttemptSecretsAdmin(admin, attemptId, secrets);

  const supabase = await createServerSupabaseClient();
  await saveSnapshotConditional(supabase, attemptId, 0, snapshotFromSession(session));
  return secrets;
}

/**
 * Apply one protocol action with full persistence (the autosave unit):
 * validate → authorise → resume → dispatch → persist snapshot (revision-guarded)
 * → sync trial/measurement/observation/calculation rows → touch activity.
 *
 * Engine rejections are persisted too (error audit), with `accepted: false`.
 * A stale `baseRevision` throws `RevisionConflictError`: the client refetches
 * and retries; nothing is silently overwritten.
 */
export async function applyTitrationAction(input: unknown): Promise<TitrationActionResult> {
  const envelope = parseTitrationEnvelope(input);
  const loaded = await loadTitrationAttempt(envelope.attemptId);

  if (!loaded.canWrite) {
    throw new Error(`Attempt ${envelope.attemptId} is no longer writable`);
  }
  if (envelope.baseRevision !== loaded.revision) {
    throw new RevisionConflictError(envelope.attemptId, envelope.baseRevision);
  }

  const { session, config } = loaded;
  const outcome = dispatchTitrationAction(session, loaded.experimentId, envelope.action);

  // Observations for endpoint colour: derived server-side from hidden truth,
  // so the stored choice reflects the simulation, not the student's claim.
  const observationRows: Array<{
    stepKey: string;
    fieldKey: string;
    textValue: string | null;
    choiceValue: string | null;
    trialRowNumber: number | null;
  }> = [];

  // Student-written observations mirror into the relational table too. They are
  // upserted by (attempt, stage, field), so replaying an action is idempotent.
  for (const observation of session.public.observations) {
    observationRows.push({
      stepKey: observation.stageKey,
      fieldKey: observation.fieldKey,
      textValue: observation.textValue,
      choiceValue: null,
      trialRowNumber: null,
    });
  }
  if (envelope.action.type === "complete_trial" || envelope.action.type === "observe_endpoint") {
    const stageKey = envelope.action.stageKey;
    const stage = session.public.stages[stageKey];
    const latest = [...stage.trials].reverse().find((t) => t.stageKey === stageKey)
      ?? stage.openTrial;
    if (latest?.deliveredMl !== null && latest?.deliveredMl !== undefined) {
      const truth = session.hidden.stages[stageKey];
      const colour = observeFlaskColour(
        config.stages.find((s) => s.key === stageKey)!.indicator,
        latest.deliveredMl,
        { equivalenceMl: truth.equivalenceMl, observableMl: truth.observableMl },
      ).colour;
      observationRows.push({
        stepKey: stageKey,
        fieldKey: `trial_${latest.trialNumber}_endpoint_colour`,
        textValue: null,
        choiceValue: colour,
        trialRowNumber: trialRowNumber(config, stageKey, latest.trialNumber),
      });
    }
  }

  const snapshot = snapshotFromSession(session);
  const supabase = await createServerSupabaseClient();
  const revision = await saveSnapshotConditional(supabase, loaded.attemptId, loaded.revision, snapshot);

  const allTrials = Object.values(session.public.stages).flatMap((s) => [
    ...s.trials,
    ...(s.openTrial ? [s.openTrial] : []),
  ]);
  const trialIds = await syncTrialRows(
    supabase,
    loaded.attemptId,
    allTrials.map((t) => trialRowFor(config, t)),
  );
  await appendMeasurementRows(
    supabase,
    loaded.attemptId,
    trialIds,
    allTrials.flatMap((t) => measurementRowsFor(config, t)),
  );
  // By-difference beaker weighings join the append-only measurement history
  // with deterministic labels, so a retried action never duplicates them.
  await appendMeasurementRows(
    supabase,
    loaded.attemptId,
    trialIds,
    Object.entries(session.public.stages).flatMap(([stageKey, stage]) =>
      preparationMeasurementRows(stageKey, stage.preparation, stage.analyteMassG),
    ),
  );
  // Part I stock volume: recorded as evidence the dilution step was performed.
  // It is deliberately not an input to any concentration (see the domain note).
  await appendMeasurementRows(
    supabase,
    loaded.attemptId,
    trialIds,
    solutionMeasurementRows(session.public.solution),
  );
  await syncObservationRows(supabase, loaded.attemptId, trialIds, observationRows);

  if (envelope.action.type === "report_molarity") {
    const action = envelope.action;
    const stage = session.public.stages[action.stageKey];
    const trial = stage.trials.find((t) => t.trialNumber === action.trialNumber);
    if (trial?.reportedMolarityM !== null && trial?.reportedMolarityM !== undefined) {
      await syncCalculationRows(supabase, loaded.attemptId, [
        {
          questionKey: `${trial.stageKey}__molarity_trial_${trial.trialNumber}`,
          studentValue: trial.reportedMolarityM,
          studentUnit: "mol/L",
          attemptNumber: trial.trialNumber,
        },
      ]);
    }
  }

  await supabase
    .from("experiment_attempts")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", loaded.attemptId);

  return {
    ...outcome,
    revision,
    public: toPublicJSON(session),
  };
}
