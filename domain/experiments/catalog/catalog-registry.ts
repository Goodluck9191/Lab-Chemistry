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
  QuestionDefinition,
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
 * One academic calculation the student performs and enters themselves.
 *
 * Every prompt here is a value the PROCEDURE asks the student to work out, and
 * every one of them is entered by hand (§20, §22). Nothing in this list carries
 * an expected value, a tolerance or a rubric: grading recomputes all of that
 * server-side after submission.
 */
export interface AcademicCalculationPrompt {
  key: string;
  prompt: string;
  unit: string;
  decimalPlaces: number;
  stageKey: string;
  /** Set when the value belongs to one recorded trial. */
  trialNumber: number | null;
  /**
   * Which of the procedure's named quantities this is. Used only for wording
   * and for the report's grouping.
   */
  kind: "declared" | "sample_mass" | "analyte_moles" | "trial_molarity" | "mean_molarity";
  isRequired: boolean;
}

/** Key convention the engine and the report both read for a per-trial titre molarity. */
export function trialMolarityKey(stageKey: string, trialNumber: number): string {
  return `${stageKey}${TRIAL_MOLARITY_INFIX}${trialNumber}`;
}

const TRIAL_MOLARITY_INFIX = "__molarity_trial_";

/** The trial number inside a per-trial molarity key, or null for any other key. */
export function trialNumberInMolarityKey(stageKey: string, key: string): number | null {
  const prefix = `${stageKey}${TRIAL_MOLARITY_INFIX}`;
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  if (!/^[0-9]{1,2}$/.test(suffix)) return null;
  const trialNumber = Number(suffix);
  return trialNumber >= 1 && trialNumber <= 20 ? trialNumber : null;
}

/**
 * The academic calculations for an attempt: the catalog's declared prompts plus
 * the quantities the procedure's own calculation steps name (the sample mass by
 * difference, the moles of analyte, each trial's molarity and the mean of the
 * two closest values).
 *
 * NO new chemistry is introduced: each derived prompt restates a step the
 * supplied procedure already includes — "the sample mass is the difference of
 * the two weighings", "calculate the NaOH molarity for each valid trial and
 * average the two closest values", and the same for the acid.
 *
 * The uncertainty is deliberately absent: the procedure asks for it only as a
 * note on the measurements, and no declared prompt exists for it, so inventing
 * one would be adding to the practical.
 */
export function academicCalculationPromptsFor(
  experimentId: string,
  stages: ReadonlyArray<{
    key: string;
    title: string;
    analytePortion: { kind: "weighed_mass" | "pipetted_volume" };
    analyteKey: string;
    titrantKey: string;
  }>,
): AcademicCalculationPrompt[] {
  const definition = experimentDefinitionFor(experimentId);
  const declared = definition?.calculations ?? [];
  const prompts: AcademicCalculationPrompt[] = [];
  for (const [index, stage] of stages.entries()) {
    const weighed = stage.analytePortion.kind === "weighed_mass";
    if (weighed) {
      prompts.push({
        key: `${stage.key}__sample_mass_g`,
        prompt: `Mass of ${stage.analyteKey} by difference (${stage.title})`,
        unit: "g",
        decimalPlaces: 2,
        stageKey: stage.key,
        trialNumber: null,
        kind: "sample_mass",
        isRequired: true,
      });
      prompts.push({
        key: `${stage.key}__analyte_moles`,
        prompt: `Moles of ${stage.analyteKey} used (${stage.title})`,
        unit: "mol",
        decimalPlaces: 6,
        stageKey: stage.key,
        trialNumber: null,
        kind: "analyte_moles",
        isRequired: true,
      });
    }
    prompts.push({
      key: `${stage.key}__mean_molarity_M`,
      prompt: `Mean concentration of ${stage.titrantKey} from the two closest titres (${stage.title})`,
      unit: "mol/L",
      decimalPlaces: 6,
      stageKey: stage.key,
      trialNumber: null,
      kind: "mean_molarity",
      isRequired: true,
    });
    // The catalog's declared prompts describe the standardisation part, which is
    // the first stage of the experiment. They keep their declared keys so an
    // existing report draft and the grader keep reading the same thing.
    if (index === 0) {
      for (const calculation of declared) {
        prompts.push({
          key: calculation.key,
          prompt: calculation.prompt,
          unit: calculation.unit,
          decimalPlaces: calculation.decimalPlaces,
          stageKey: stage.key,
          trialNumber: null,
          kind: "declared",
          isRequired: false,
        });
      }
    }
  }
  return prompts;
}

/**
 * Every calculation key an attempt may report: the stage-level prompts above,
 * plus one molarity prompt per recorded trial (which is what the concordance
 * rule is judged on).
 */
export function academicCalculationKeysFor(
  experimentId: string,
  stages: Parameters<typeof academicCalculationPromptsFor>[1],
  recordedTrialNumbers: ReadonlyArray<{ stageKey: string; trialNumber: number }>,
): string[] {
  return [
    ...academicCalculationPromptsFor(experimentId, stages).map((prompt) => prompt.key),
    ...recordedTrialNumbers.map((trial) => trialMolarityKey(trial.stageKey, trial.trialNumber)),
  ];
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

/** The declared report question with its deterministic keyword rubric. */
export type DeclaredQuestion = Pick<
  QuestionDefinition,
  "key" | "prompt" | "keywords" | "fullMarksAt" | "halfMarksAt" | "points" | "isRequired"
>;

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

/**
 * Report questions for an attempt. An empty list means the experiment
 * declares no questions, and the application layer then accepts no answers.
 */
export function declaredQuestionsFor(experimentId: string): DeclaredQuestion[] {
  const definition = experimentDefinitionFor(experimentId);
  if (!definition) return [];
  return (definition.questions ?? []).map((question) => ({
    key: question.key,
    prompt: question.prompt,
    keywords: [...question.keywords],
    fullMarksAt: question.fullMarksAt,
    halfMarksAt: question.halfMarksAt,
    points: question.points,
    isRequired: question.isRequired,
  }));
}
