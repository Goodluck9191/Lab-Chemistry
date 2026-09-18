/**
 * Relational projections of the titration session.
 *
 * The snapshot document (`attempt_state.snapshot.titration`) is the resume
 * source of truth. These row shapes mirror the same facts into the
 * audit-friendly tables (`experiment_trials`, `measurements`,
 * `observations`, `calculation_submissions`) for grading and instructor
 * review. Rows never feed back into the engine.
 */
import type { TitrationExperimentConfig } from "./config";
import type { StagePreparation, WorkingSolutionPreparation } from "./engine";
import type { TrialRecord as EngineTrialRecord } from "./trials";

export type DbTrialStatus = "open" | "recorded" | "rejected";

export interface TrialRow {
  trialNumber: number;
  /** Stage that ran the trial; persisted for grading queries (snapshot stays the resume truth). */
  stageKey: string;
  status: DbTrialStatus;
  initialReading: number | null;
  finalReading: number | null;
  titreVolume: number | null;
  endpointObserved: boolean | null;
  rejectionReason: string | null;
}

export interface MeasurementRow {
  kind: "titration_reading" | "mass" | "volume";
  label: string;
  value: number;
  unit: string;
  trialRowNumber: number | null;
}

export interface ObservationRow {
  stepKey: string;
  fieldKey: string;
  textValue: string | null;
  choiceValue: string | null;
}

export interface CalculationRow {
  questionKey: string;
  studentValue: number;
  studentUnit: string;
  attemptNumber: number;
}

function dbTrialStatus(status: EngineTrialRecord["status"]): DbTrialStatus {
  return status === "discarded_overshoot" ? "rejected" : status;
}

/**
 * Relational row number for a trial.
 *
 * `experiment_trials` constrains `trial_number` to 1..20 and unique per attempt,
 * so the stages share ONE numbering space: each stage owns an equal, FIXED block
 * of it (stride = floor(20 / stage count)). Stage A therefore holds 1..10 and
 * Stage B 11..20 for a two-stage experiment.
 *
 * The stride is deliberately not `maxTrials`: a stage may run more attempts than
 * it records, because a discarded overshoot is repeated rather than counted, and
 * a per-stage block leaves room for those repeats without ever colliding with
 * the next stage's first trial. `parseTitrationConfig` refuses a configuration
 * whose `maxTrialAttempts` would not fit its block.
 *
 * The student always sees per-stage trial numbers (from the snapshot); this
 * shared numbering exists only for the unique constraint, and `stage_key`
 * states the attribution explicitly so a grading query never has to infer it.
 */
export function trialRowNumber(
  config: TitrationExperimentConfig,
  stageKey: string,
  trialNumber: number,
): number {
  const stageIndex = config.stages.findIndex((s) => s.key === stageKey);
  if (stageIndex < 0) throw new Error(`unknown stage ${stageKey}`);
  const stride = Math.floor(20 / config.stages.length);
  const rowNumber = stageIndex * stride + trialNumber;
  if (rowNumber < 1 || rowNumber > 20) {
    throw new Error(`trial row number ${rowNumber} outside the 1..20 table range`);
  }
  return rowNumber;
}

export function trialRowFor(
  config: TitrationExperimentConfig,
  trial: EngineTrialRecord,
): TrialRow {
  return {
    trialNumber: trialRowNumber(config, trial.stageKey, trial.trialNumber),
    stageKey: trial.stageKey,
    status: dbTrialStatus(trial.status),
    initialReading: trial.initialReadingMl,
    finalReading: trial.finalReadingMl,
    titreVolume: trial.deliveredMl,
    endpointObserved:
      trial.endpointJudgement === null ? null : trial.endpointJudgement === "correct",
    rejectionReason:
      trial.rejectionReason ??
      (trial.status === "discarded_overshoot" ? "endpoint overshot" : null),
  };
}

export function measurementRowsFor(
  config: TitrationExperimentConfig,
  trial: EngineTrialRecord,
): MeasurementRow[] {
  const rowNumber = trialRowNumber(config, trial.stageKey, trial.trialNumber);
  const rows: MeasurementRow[] = [
    {
      kind: "titration_reading",
      label: `${trial.stageKey} trial ${trial.trialNumber} initial burette reading`,
      value: trial.initialReadingMl,
      unit: "mL",
      trialRowNumber: rowNumber,
    },
  ];
  if (trial.finalReadingMl !== null) {
    rows.push({
      kind: "titration_reading",
      label: `${trial.stageKey} trial ${trial.trialNumber} final burette reading`,
      value: trial.finalReadingMl,
      unit: "mL",
      trialRowNumber: rowNumber,
    });
  }
  if (trial.deliveredMl !== null) {
    rows.push({
      kind: "titration_reading",
      label: `${trial.stageKey} trial ${trial.trialNumber} titre volume`,
      value: trial.deliveredMl,
      unit: "mL",
      trialRowNumber: rowNumber,
    });
  }
  return rows;
}

/**
 * Measurement row for the Part I stock volume the student measured.
 *
 * Recorded as evidence that the dilution step was performed. It is deliberately
 * NOT an input to any concentration: the procedure states no final
 * concentration for the prepared solution, so none is derived here.
 */
export function solutionMeasurementRows(solution: WorkingSolutionPreparation): MeasurementRow[] {
  if (solution.stockVolumeMl === null) return [];
  return [
    {
      kind: "volume",
      label: `part-i ${solution.stockVolumeMl.toFixed(2)} mL stock measured for the working solution`,
      value: solution.stockVolumeMl,
      unit: "mL",
      trialRowNumber: null,
    },
  ];
}

/**
 * Measurement rows for the by-difference beaker weighings plus the derived
 * sample mass. Labels are deterministic per stage, so the append-only history
 * keeps the first write (re-weighing a completed pair is refused by the
 * engine) exactly like the trial readings above.
 */
export function preparationMeasurementRows(
  stageKey: string,
  preparation: StagePreparation,
  sampleMassG: number | null,
): MeasurementRow[] {
  const rows: MeasurementRow[] = [];
  if (preparation.beakerMassG !== null) {
    rows.push({
      kind: "mass",
      label: `${stageKey} empty beaker mass`,
      value: preparation.beakerMassG,
      unit: "g",
      trialRowNumber: null,
    });
  }
  if (preparation.beakerPlusKhpMassG !== null) {
    rows.push({
      kind: "mass",
      label: `${stageKey} beaker plus khp mass`,
      value: preparation.beakerPlusKhpMassG,
      unit: "g",
      trialRowNumber: null,
    });
  }
  if (sampleMassG !== null) {
    rows.push({
      kind: "mass",
      label: `${stageKey} khp sample mass by difference`,
      value: sampleMassG,
      unit: "g",
      trialRowNumber: null,
    });
  }
  return rows;
}
