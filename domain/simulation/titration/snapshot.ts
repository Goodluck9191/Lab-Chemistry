/**
 * Session snapshot mapping: the engine's namespaced session in and out of the
 * persisted `SimulationState`, plus hidden-state serialisation for
 * `attempt_secrets`.
 *
 * Two projections are maintained side by side:
 * - `snapshot.titration` — the exact public session; the resume source of truth.
 * - the generic trials/measurements/calculations arrays (and the matching
 *   relational rows) — audit trail and grading inputs.
 * Rows never feed back into the engine; resume reads the snapshot document.
 */
import {
  createInitialSimulationState,
  simulationStateSchema,
  type SimulationState,
} from "@/domain/simulation";
import type { AttemptSecrets } from "@/domain/simulation/secrets";
import type { TitrationExperimentConfig } from "./config";
import {
  emptyPreparation,
  emptyWorkingSolution,
  projectPublicState,
  type StageSession,
  type TitrationPublicState,
  type TitrationSession,
  type TitrationSessionState,
} from "./engine";
import { measurementRowsFor, trialRowFor } from "./persistence";
import { titrationPublicStateSchema, type StoredStageSession } from "./schema";

// ---------------------------------------------------------------------------
// Secrets serialisation
// ---------------------------------------------------------------------------

export function secretsForStorage(
  seed: string,
  session: Pick<TitrationSession, "hidden" | "config">,
): AttemptSecrets {
  const trueValues: Record<string, number> = {};
  const expectedEndpoint: Record<string, number> = {};
  for (const [stageKey, truth] of Object.entries(session.hidden.stages)) {
    trueValues[`${stageKey}__titrant_M`] = truth.trueTitrantMolarityM;
    if (truth.trueAnalyteMassG !== null) {
      trueValues[`${stageKey}__analyte_mass_g`] = truth.trueAnalyteMassG;
    }
    if (truth.trueAnalyteMolarityM !== null) {
      trueValues[`${stageKey}__analyte_M`] = truth.trueAnalyteMolarityM;
    }
    trueValues[`${stageKey}__analyte_moles`] = truth.analyteMoles;
    expectedEndpoint[`${stageKey}__equivalence_ml`] = truth.equivalenceMl;
    expectedEndpoint[`${stageKey}__observable_ml`] = truth.observableMl;
  }
  return {
    seed,
    trueValues,
    expectedEndpoint,
    rubricWeights: { ...session.config.assessmentWeights },
  };
}

function requiredNumber(record: Record<string, number | string>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`attempt secrets are corrupt: missing numeric ${key}`);
  }
  return value;
}

/** Rebuild hidden engine state from the stored secrets. Fails loudly on corruption. */
export function hiddenFromSecrets(
  secrets: AttemptSecrets,
  config: TitrationExperimentConfig,
): TitrationSession["hidden"] {
  if (!secrets.seed) throw new Error("attempt secrets are corrupt: missing seed");
  const stages: TitrationSession["hidden"]["stages"] = {};
  for (const stage of config.stages) {
    stages[stage.key] = {
      stageKey: stage.key,
      trueTitrantMolarityM: requiredNumber(secrets.trueValues, `${stage.key}__titrant_M`),
      trueAnalyteMassG:
        stage.analytePortion.kind === "weighed_mass"
          ? requiredNumber(secrets.trueValues, `${stage.key}__analyte_mass_g`)
          : null,
      trueAnalyteMolarityM:
        stage.analytePortion.kind === "pipetted_volume"
          ? requiredNumber(secrets.trueValues, `${stage.key}__analyte_M`)
          : null,
      analyteMoles: requiredNumber(secrets.trueValues, `${stage.key}__analyte_moles`),
      equivalenceMl: requiredNumber(secrets.expectedEndpoint, `${stage.key}__equivalence_ml`),
      observableMl: requiredNumber(secrets.expectedEndpoint, `${stage.key}__observable_ml`),
    };
  }
  return { seed: secrets.seed, stages };
}

// ---------------------------------------------------------------------------
// Snapshot mapping
// ---------------------------------------------------------------------------

/**
 * Stage the student is currently working in: the first stage that still needs
 * trials, otherwise the last configured stage. Derived from public data only.
 */
function activeStageKey(session: TitrationSession, publicState: TitrationPublicState): string {
  const keys = Object.keys(publicState.stages);
  for (const key of keys) {
    if (publicState.stages[key].concordance.recordedTrials < publicState.stages[key].concordance.requiredTrials) {
      return key;
    }
  }
  return keys[keys.length - 1] ?? "titration";
}

/** Full snapshot written on every accepted action (autosave unit). */
export function snapshotFromSession(session: TitrationSession): SimulationState {
  const base = createInitialSimulationState();
  // Projected (not raw) state: the stored document carries the same derived
  // concordance the browser sees, and is validated before it is persisted.
  const publicState = projectPublicState(session);
  const activeStage = activeStageKey(session, publicState);

  for (const trial of Object.values(publicState.stages).flatMap((s) => [
    ...s.trials,
    ...(s.openTrial ? [s.openTrial] : []),
  ])) {
    const row = trialRowFor(session.config, trial);
    base.trials.push({
      trialNumber: row.trialNumber,
      status: row.status,
      initialReading: row.initialReading ?? undefined,
      finalReading: row.finalReading ?? undefined,
      titreVolume: row.titreVolume ?? undefined,
      endpointObserved: row.endpointObserved ?? undefined,
      rejectionReason: row.rejectionReason ?? undefined,
    });
    for (const m of measurementRowsFor(session.config, trial)) {
      base.measurements.push({
        kind: m.kind,
        label: m.label,
        value: m.value,
        unit: m.unit,
        recordedAt: new Date().toISOString(),
        serverValidated: true,
      });
    }
    if (trial.reportedMolarityM !== null) {
      base.calculations.push({
        questionKey: `${trial.stageKey}__molarity_trial_${trial.trialNumber}`,
        studentValue: trial.reportedMolarityM,
        unit: "mol/L",
        attemptNumber: trial.trialNumber,
      });
    }
  }

  // Student-written observations mirror into the generic audit array as well as
  // the relational rows, so an instructor read of the snapshot sees them.
  for (const observation of publicState.observations) {
    base.observations.push({
      stepKey: observation.stageKey,
      fieldKey: observation.fieldKey,
      textValue: observation.textValue,
    });
  }

  return {
    ...base,
    currentStep: activeStage,
    titration: titrationPublicStateSchema.parse(publicState),
  };
}

/**
 * Strip the derived concordance a stage may carry in the persisted document.
 * Preparation is handled by the caller, which normalises a missing value to
 * the empty preparation (snapshots written before it existed still resume).
 */
function toSessionStage(stage: StoredStageSession): Omit<StageSession, "preparation"> {
  return {
    phase: stage.phase,
    apparatusReady: stage.apparatusReady,
    indicatorDrops: stage.indicatorDrops,
    analyteMassG: stage.analyteMassG,
    analyteVolumeMl: stage.analyteVolumeMl,
    buretteInitialMl: stage.buretteInitialMl,
    deliveredSoFarMl: stage.deliveredSoFarMl,
    flaskColour: stage.flaskColour,
    trials: stage.trials,
    reportedMolaritiesM: stage.reportedMolaritiesM,
    openTrial: stage.openTrial,
  };
}

/** Rebuild a resumable engine session. Throws on missing/corrupt data. */
export function resumeSessionFromSnapshot(
  config: TitrationExperimentConfig,
  secrets: AttemptSecrets,
  snapshot: SimulationState,
): TitrationSession {
  const parsed = simulationStateSchema.parse(snapshot);
  if (!parsed.titration) {
    throw new Error("snapshot has no titration session to resume");
  }
  if (parsed.titration.experimentNumber !== config.experimentNumber) {
    throw new Error("snapshot belongs to a different experiment");
  }
  const stored = parsed.titration;
  const stages: Record<string, StageSession> = {};
  for (const [key, stage] of Object.entries(stored.stages)) {
    stages[key] = {
      ...toSessionStage(stage),
      // Snapshots written before preparation existed resume as unprepared;
      // every stage gets its own object, never a shared default.
      preparation: stage.preparation ?? emptyPreparation(),
    };
  }
  const publicState: TitrationSessionState = {
    schemaVersion: stored.schemaVersion,
    experimentNumber: stored.experimentNumber,
    stages,
    // A snapshot written before the Part I dilution steps existed resumes at
    // the start of Part I rather than failing to load.
    solution: stored.solution ?? emptyWorkingSolution(),
    errorEvents: JSON.parse(JSON.stringify(stored.errorEvents)) as TitrationSessionState["errorEvents"],
    completedTrials: stored.completedTrials,
    observations: JSON.parse(JSON.stringify(stored.observations)) as TitrationSessionState["observations"],
  };
  return {
    config,
    hidden: hiddenFromSecrets(secrets, config),
    public: publicState,
  };
}
