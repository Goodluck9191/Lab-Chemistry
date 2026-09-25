import type { EXPERIMENT_STATUSES, EXPERIMENT_TYPES, TITRATION_SUBTYPES } from "./constants";

export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];
export type TitrationSubtype = (typeof TITRATION_SUBTYPES)[number];
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export type ChemicalRole =
  | "titrant"
  | "analyte"
  | "indicator"
  | "reagent"
  | "primary_standard"
  | "solvent"
  | "wash"
  | "drying_agent"
  | "other";

export type AssessmentCategory =
  | "apparatus"
  | "chemicals"
  | "safety"
  | "sequence"
  | "technique"
  | "endpoint"
  | "concordance"
  | "calculations"
  | "observations"
  | "report";

/**
 * The seam that keeps experiments configuration-driven: an experiment declares
 * WHICH engine runs it and the parameters for that engine. Every engine
 * understands the generic shape, so a new experiment in an existing family is
 * new data, not new code.
 */
export interface EngineDescriptor {
  kind: ExperimentType;
  family: string;
  parameters: Record<string, unknown>;
}

export interface ProcedureStep {
  stepNumber: number;
  title: string;
  instruction: string;
  isRequired: boolean;
}

export interface Chemical {
  key: string;
  name: string;
  formula?: string;
  role: ChemicalRole;
  concentration?: number;
  concentrationUnit?: string;
  hazardCodes: string[];
  isRequired: boolean;
}

export interface Apparatus {
  key: string;
  name: string;
  capacityMl?: number;
  graduationMl?: number;
  isRequired: boolean;
}

export interface CalculationDefinition {
  key: string;
  prompt: string;
  unit: string;
  decimalPlaces: number;
  tolerance: { kind: "relative" | "absolute"; value: number };
}

export interface ObservationDefinition {
  stepKey: string;
  fieldKey: string;
  prompt: string;
  kind: "text" | "choice";
  expectKeywords?: string[];
  choices?: string[];
  isRequired: boolean;
}

export interface GradingRule {
  key: string;
  category: AssessmentCategory;
  points: number;
  description: string;
}

export interface QuestionDefinition {
  key: string;
  prompt: string;
  keywords: string[];
  fullMarksAt: number;
  halfMarksAt: number;
  points: number;
  isRequired: boolean;
}

/**
 * A complete experiment definition. Hidden experimental parameters are NOT part
 * of this type: they are generated per attempt, server-side, and live in the
 * server-only `attempt_secrets` table.
 */
export interface ExperimentDefinition {
  id: string;
  number: number;
  slug: string;
  title: string;
  description: string;
  aim: string;
  theory: string;
  safety: string[];
  type: ExperimentType;
  subtype: TitrationSubtype | null;
  status: ExperimentStatus;
  orderIndex: number;
  engine: EngineDescriptor;
  procedure: ProcedureStep[];
  chemicals: Chemical[];
  apparatus: Apparatus[];
  calculations: CalculationDefinition[];
  observations: ObservationDefinition[];
  questions: QuestionDefinition[];
  gradingRules: GradingRule[];
  configVersion: number;
  /** "assumed" marks chemistry not yet verified against the practical manual. */
  accuracy: "assumed" | "manual-verified";
}

/** Lightweight projection used by lists and cards. */
export interface ExperimentSummary {
  id: string;
  number: number;
  slug: string;
  title: string;
  description: string;
  type: ExperimentType;
  subtype: TitrationSubtype | null;
  status: ExperimentStatus;
  orderIndex: number;
  accuracy: ExperimentDefinition["accuracy"];
}

/**
 * The public projection of an experiment, as stored in the database (the
 * `experiments` row plus its ordered steps, chemicals and apparatus). Hidden
 * simulation parameters are intentionally absent: they live in
 * `attempt_secrets`, which no client can read.
 */
export interface ExperimentBriefing {
  id: string;
  number: number;
  slug: string;
  title: string;
  description: string;
  aim: string;
  theory: string;
  safety: string[];
  type: ExperimentType;
  subtype: TitrationSubtype | null;
  status: ExperimentStatus;
  orderIndex: number;
  configVersion: number;
  accuracy: ExperimentDefinition["accuracy"];
  procedure: ProcedureStep[];
  chemicals: Chemical[];
  apparatus: Apparatus[];
}
