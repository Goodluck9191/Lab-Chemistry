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
import type { TrialRecord as EngineTrialRecord } from "./trials";

export type DbTrialStatus = "open" | "recorded" | "rejected";

export interface TrialRow {
  trialNumber: number;
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
 * Relational row number for a trial. The table constrains trial_number to
 * 1..20 and unique per attempt, so stages share one numbering space:
 * stage index x maxTrials + trial number.
 */
export function trialRowNumber(
  config: TitrationExperimentConfig,
  stageKey: string,
  trialNumber: number,
): number {
  const stageIndex = config.stages.findIndex((s) => s.key === stageKey);
  if (stageIndex < 0) throw new Error(`unknown stage ${stageKey}`);
  const rowNumber = stageIndex * config.trialRules.maxTrials + trialNumber;
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
