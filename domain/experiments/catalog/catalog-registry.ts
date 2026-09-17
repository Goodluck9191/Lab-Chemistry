/**
 * Experiment definition registry, keyed by experiment id.
 *
 * WHY THIS EXISTS: the public database catalog (`experiments`,
 * `experiment_steps`, `experiment_chemicals`, `experiment_apparatus`) has no
 * place to store observation prompts or calculation prompts — those tables were
 * never created. The full `ExperimentDefinition` in this folder is therefore the
 * only source for "what must the student record" and "what must the student
 * calculate", and the laboratory UI reads them through this registry rather
 * than inventing prompts in a React component.
 *
 * Nothing hidden lives here: these are the student-facing prompts and units
 * that already existed as configuration, exposed as narrow projections.
 */
import type {
  CalculationDefinition,
  ExperimentDefinition,
  ObservationDefinition,
} from "@/domain/experiments/types";
import { exp02Standardisation } from "./exp-02-standardisation";

const DEFINITIONS: Record<string, ExperimentDefinition> = {
  "exp-02": exp02Standardisation,
};

/** The declared observation prompt the endpoint panel records, verbatim. */
export type DeclaredObservationField = Pick<
  ObservationDefinition,
  "stepKey" | "fieldKey" | "prompt" | "kind" | "isRequired"
>;

/** The declared calculation prompt for one reported quantity. */
export type DeclaredCalculation = Pick<
  CalculationDefinition,
  "key" | "prompt" | "unit" | "decimalPlaces"
>;

export function experimentDefinitionFor(experimentId: string): ExperimentDefinition | null {
  return DEFINITIONS[experimentId] ?? null;
}

/**
 * Observation fields an attempt may record. An empty list means the
 * experiment declares no observations, and the application layer then refuses
 * every `record_observation` action rather than accepting free-form keys.
 */
export function declaredObservationFieldsFor(experimentId: string): DeclaredObservationField[] {
  const definition = experimentDefinitionFor(experimentId);
  if (!definition) return [];
  return definition.observations.map((observation) => ({
    stepKey: observation.stepKey,
    fieldKey: observation.fieldKey,
    prompt: observation.prompt,
    kind: observation.kind,
    isRequired: observation.isRequired,
  }));
}

export function declaredCalculationPromptsFor(experimentId: string): DeclaredCalculation[] {
  const definition = experimentDefinitionFor(experimentId);
  if (!definition) return [];
  return definition.calculations.map((calculation) => ({
    key: calculation.key,
    prompt: calculation.prompt,
    unit: calculation.unit,
    decimalPlaces: calculation.decimalPlaces,
  }));
}
