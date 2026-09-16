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
import type { TitrationPublicState, TitrationSession } from "./engine";
import { measurementRowsFor, trialRowFor } from "./persistence";
import { titrationPublicStateSchema } from "./schema";

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

/** Full snapshot written on every accepted action (autosave unit). */
export function snapshotFromSession(session: TitrationSession): SimulationState {
  const base = createInitialSimulationState();
  const publicState: TitrationPublicState = JSON.parse(JSON.stringify(session.public));
  const activeStageKey = Object.keys(publicState.stages)[0] ?? "titration";

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

  return {
    ...base,
    currentStep: activeStageKey,
    titration: titrationPublicStateSchema.parse(publicState),
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
  return {
    config,
    hidden: hiddenFromSecrets(secrets, config),
    public: JSON.parse(JSON.stringify(parsed.titration)) as TitrationPublicState,
  };
}
