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
import { deriveHiddenState } from "./hidden";
import {
  emptyPreparation,
  emptyWorkingSolution,
  projectPublicState,
  reconcileSessionPhases,
  type StageSession,
  type TitrationPublicState,
  type TitrationSession,
  type TitrationSessionState,
} from "./engine";
import { measurementRowsFor, readingAccuracyRows, trialRowFor } from "./persistence";
import { emptyStageWorld } from "./world";
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
  // The beaker tare is instrument truth, not an answer key: it is what the
  // balance displays with the dry beaker on the pan, and the student still has
  // to subtract their own two readings. Stored with the other hidden values so
  // the world cannot be set from the browser.
  trueValues.__beaker_tare_g = session.hidden.beakerTareG;
  for (const [stageKey, truth] of Object.entries(session.hidden.stages)) {
    trueValues[`${stageKey}__titrant_M`] = truth.trueTitrantMolarityM;
    trueValues[`${stageKey}__burette_fill_ml`] = truth.buretteFillLevelMl;
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

/**
 * Read a value that may predate this phase.
 *
 * The world facts added in this phase are derived deterministically from the
 * seed, which the secrets already carry, so an attempt created earlier can
 * simply re-derive them instead of failing to resume. Every pre-existing key
 * stays REQUIRED: a missing concentration is still corruption.
 */
function derivedNumber(
  record: Record<string, number | string>,
  key: string,
  derive: () => number,
): number {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return derive();
}

/** Rebuild hidden engine state from the stored secrets. Fails loudly on corruption. */
export function hiddenFromSecrets(
  secrets: AttemptSecrets,
  config: TitrationExperimentConfig,
): TitrationSession["hidden"] {
  if (!secrets.seed) throw new Error("attempt secrets are corrupt: missing seed");
  // The fallback for keys an older attempt never stored. Deterministic in the
  // seed, so re-deriving is the same act as computing it in the first place.
  const derived = deriveHiddenState(config, secrets.seed, config.endpointBiasMl);
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
      buretteFillLevelMl: derivedNumber(
        secrets.trueValues,
        `${stage.key}__burette_fill_ml`,
        () => derived.stages[stage.key].buretteFillLevelMl,
      ),
    };
  }
  return {
    seed: secrets.seed,
    beakerTareG: derivedNumber(
      secrets.trueValues,
      "__beaker_tare_g",
      () => derived.beakerTareG,
    ),
    stages,
  };
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

  // Reading accuracy (§28): what each instrument SHOWED beside what the student
  // recorded, with the deviation between them. The world row is server-validated;
  // the recorded row is the student's, mistakes and all.
  for (const [stageKey, stage] of Object.entries(publicState.stages)) {
    const truth = session.hidden.stages[stageKey];
    const accuracy = readingAccuracyRows({
      stageKey,
      preparation: stage.preparation,
      world: stage.world,
      observation: stage.observation,
      buretteFillLevelMl: truth?.buretteFillLevelMl ?? 0,
      trueSampleMassG: truth?.trueAnalyteMassG ?? null,
      beakerTareG: session.hidden.beakerTareG,
      trials: stage.trials,
      recordedCylinderMl: stage.analyteVolumeMl,
    });
    for (const row of accuracy) {
      base.measurements.push({
        kind: row.kind,
        label: row.label,
        value: row.value,
        unit: row.unit,
        recordedAt: new Date().toISOString(),
        serverValidated: row.serverValidated ?? false,
        deviation: row.deviation,
      });
    }
  }

  // The Part I stock volume is recorded against the solution, not a stage.
  if (publicState.solution.stockVolumeMl !== null) {
    const firstStage = Object.values(publicState.stages)[0];
    if (firstStage) {
      base.measurements.push({
        kind: "volume",
        label: "part-i stock volume · instrument",
        value: publicState.solution.stockVolumeMl,
        unit: "mL",
        recordedAt: new Date().toISOString(),
        serverValidated: true,
      });
    }
  }

  // The student's own calculation values, mirrored into the audit array.
  for (const calculation of publicState.calculations) {
    base.calculations.push({
      questionKey: calculation.questionKey,
      studentValue: calculation.value,
      unit: calculation.unit,
      attemptNumber: calculation.trialNumber ?? 1,
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
    // A snapshot written before the world layer existed resumes with a clean
    // bench: the burette back in its cradle, the tap shut.
    world: stage.world ?? emptyStageWorld(),
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
    // Student-entered calculations are additive: an older snapshot resumes with
    // none, which is exactly what a student who has not calculated anything has.
    calculations: JSON.parse(
      JSON.stringify(stored.calculations ?? []),
    ) as TitrationSessionState["calculations"],
    procedureStep: stored.procedureStep ?? 1,
  };
  const session: TitrationSession = {
    config,
    hidden: hiddenFromSecrets(secrets, config),
    public: publicState,
  };
  // A resumed stage whose phase contradicts its own recorded preparation (a
  // snapshot taken after a rewind) is lifted back to the phase its evidence
  // implies, so the attempt can be finished instead of loading into a state
  // where every route forward is refused. Pure derivation; nothing is invented.
  reconcileSessionPhases(session);
  return session;
}
