import type { ExperimentType } from "../experiments/types";
import type { AttemptSecrets } from "./secrets";

/**
 * DOMAIN CONTRACTS ONLY. Stage 1 defines the shape of a running experiment but
 * deliberately implements no simulation behaviour: engines arrive with the
 * titration/gravimetric/synthesis/conductometry work.
 *
 * `SimulationState` is persisted verbatim as jsonb in `attempt_state.snapshot`,
 * which is why it is a single document rather than a set of database columns.
 */
export interface SimulationState {
  schemaVersion: number;
  currentStep: string;
  apparatus: SelectedApparatus[];
  chemicals: ChemicalQuantity[];
  solutionVolumes: SolutionVolume[];
  concentrations: ConcentrationRecord[];
  temperature: TemperatureRecord | null;
  colours: ColourRecord[];
  precipitates: PrecipitateRecord[];
  measurements: Measurement[];
  trials: Trial[];
  observations: Observation[];
  calculations: CalculationResult[];
  safetyEvents: SafetyEvent[];
  score: ScoreState;
}

export interface SelectedApparatus {
  key: string;
  mountedAt: string;
  contents: string[];
}

export interface ChemicalQuantity {
  key: string;
  amount: number;
  unit: string;
  vesselKey: string;
}

export interface SolutionVolume {
  vesselKey: string;
  volumeMl: number;
  species: string[];
}

export interface ConcentrationRecord {
  species: string;
  molarity: number;
}

export interface TemperatureRecord {
  celsius: number;
  recordedAt: string;
}

export interface ColourRecord {
  vesselKey: string;
  colour: string;
  description: string;
}

export interface PrecipitateRecord {
  vesselKey: string;
  formula: string;
  description: string;
}

export type MeasurementKind =
  | "titration_reading"
  | "mass"
  | "temperature"
  | "conductivity"
  | "volume"
  | "colour"
  | "other";

export interface Measurement {
  id?: string;
  trialId?: string | null;
  kind: MeasurementKind;
  label: string;
  value: number;
  unit: string;
  recordedAt: string;
  serverValidated?: boolean;
  deviation?: number;
}

export interface Trial {
  trialNumber: number;
  status: "open" | "recorded" | "rejected";
  initialReading?: number;
  finalReading?: number;
  titreVolume?: number;
  endpointObserved?: boolean;
  rejectionReason?: string;
}

export interface Observation {
  stepKey: string;
  fieldKey: string;
  textValue?: string;
  choiceValue?: string;
}

export interface CalculationResult {
  questionKey: string;
  studentValue: number;
  unit: string;
  isCorrect?: boolean;
  attemptNumber: number;
}

export interface ScoreEvent {
  ruleKey: string;
  severity: "info" | "warning" | "critical";
  points: number;
  message: string;
  at: string;
}

export interface SafetyEvent extends ScoreEvent {
  recordedForInstructor: boolean;
  blockedNextStep: boolean;
}

export interface ScoreState {
  awarded: number;
  possible: number;
  events: ScoreEvent[];
}

export interface AssessmentResult {
  autoScore: number;
  breakdown: RubricLine[];
  scoreEvents: ScoreEvent[];
  submittedAt: string;
}

export interface RubricLine {
  ruleKey: string;
  category: string;
  awarded: number;
  max: number;
  justification: string;
}

/** What the browser is allowed to see. Produced by `SimulationEngine.view`
 * and, by construction, never contains hidden parameters. */
export interface EngineView {
  state: SimulationState;
  availableApparatus: string[];
  availableChemicals: string[];
  currentStepInstruction: string;
}

export type SimulationAction =
  | { type: "SELECT_APPARATUS"; apparatusKey: string }
  | { type: "ADD_CHEMICAL"; chemicalKey: string; amount: number; unit: string }
  | { type: "TRANSFER"; chemicalKey: string; vesselKey: string }
  | { type: "RECORD_MEASUREMENT"; measurement: Measurement }
  | { type: "RECORD_OBSERVATION"; observation: Observation }
  | { type: "START_TRIAL" }
  | { type: "END_TRIAL"; trialNumber: number }
  | { type: "REJECT_TRIAL"; trialNumber: number; reason: string }
  | { type: "SUBMIT_CALCULATION"; result: CalculationResult };

export interface ApplyResult {
  state: SimulationState;
  events: SafetyEvent[];
  blocked?: { reason: string };
}

/**
 * Every engine implements this contract. The configuration decides which engine
 * runs an experiment and with which parameters, so a new experiment in an
 * existing family requires no engine change.
 */
export interface SimulationEngine<Config = unknown> {
  readonly kind: ExperimentType;
  init(config: Config, secrets: AttemptSecrets, seed: string): SimulationState;
  apply(config: Config, state: SimulationState, action: SimulationAction): ApplyResult;
  /** Sanitised projection: safe to send to the student's browser. */
  view(config: Config, state: SimulationState): EngineView;
  grade(config: Config, secrets: AttemptSecrets, state: SimulationState): AssessmentResult;
}
