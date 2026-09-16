import "server-only";
import { randomUUID } from "node:crypto";
import { requireStudent } from "@/application/auth/dal";
import { canWriteAttemptData } from "@/application/auth/access";
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
  addIndicator,
  addTitrant,
  completeTrial,
  createTitrationSession,
  observeEndpoint,
  pipetteAnalyte,
  readBurette,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  toPublicJSON,
  weighAnalyte,
  type ActionResult,
  type TitrationPublicState,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import { observeFlaskColour } from "@/domain/simulation/titration/endpoint";
import {
  measurementRowsFor,
  trialRowFor,
  trialRowNumber,
} from "@/domain/simulation/titration/persistence";
import {
  parseTitrationEnvelope,
  type TitrationProtocolAction,
} from "@/domain/simulation/titration/protocol";
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

type DispatchOutcome = Pick<
  TitrationActionResult,
  "accepted" | "code" | "message" | "colour" | "calculationCorrect"
>;

function rejected(result: ActionResult): DispatchOutcome {
  return {
    accepted: false,
    code: "code" in result && typeof result.code === "string" ? result.code : "rejected",
    message:
      "error" in result && typeof result.error === "string" ? result.error : "Action rejected",
    colour: null,
    calculationCorrect: null,
  };
}

function acceptedOutcome(extra: Partial<DispatchOutcome> = {}): DispatchOutcome {
  return { accepted: true, code: null, message: null, colour: null, calculationCorrect: null, ...extra };
}

/** Route one validated protocol action into the engine. Engine-only rejections. */
function dispatch(session: TitrationSession, action: TitrationProtocolAction): DispatchOutcome {
  switch (action.type) {
    case "setup_apparatus": {
      const result = setupApparatus(session, action.stageKey, action.titrantKey, action.initialReadingMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "weigh_analyte": {
      const result = weighAnalyte(session, action.stageKey, action.observedMassG);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "pipette_analyte": {
      const result = pipetteAnalyte(session, action.stageKey, action.observedVolumeMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "add_indicator": {
      const result = addIndicator(session, action.stageKey, action.drops);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "start_trial": {
      const result = startTrialAction(session, action.stageKey, action.trialNumber, action.initialReadingMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "add_titrant": {
      const result = addTitrant(session, action.stageKey, action.volumeMl);
      return result.ok ? acceptedOutcome({ colour: result.colour ?? null }) : rejected(result);
    }
    case "read_burette": {
      const result = readBurette(session, action.stageKey, action.observedFinalMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "observe_endpoint": {
      const result = observeEndpoint(session, action.stageKey, action.claimedColour);
      return result.ok ? acceptedOutcome({ colour: result.actual ?? null }) : rejected(result);
    }
    case "complete_trial": {
      const result = completeTrial(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "report_molarity": {
      const result = reportMolarity(session, action.stageKey, action.trialNumber, action.studentMolarityM);
      // `expected` is stripped here: it must never cross to the browser.
      return result.ok
        ? acceptedOutcome({ calculationCorrect: result.correct ?? null })
        : rejected(result);
    }
  }
}

export interface LoadedTitrationAttempt {
  attemptId: string;
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
  return { attemptId: id, config, session, revision: stored.revision, canWrite };
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
  const outcome = dispatch(session, envelope.action);

  // Observations for endpoint colour: derived server-side from hidden truth,
  // so the stored choice reflects the simulation, not the student's claim.
  const observationRows: Array<{
    stepKey: string;
    fieldKey: string;
    textValue: null;
    choiceValue: string;
    trialRowNumber: number | null;
  }> = [];
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
