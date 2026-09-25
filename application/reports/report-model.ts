import "server-only";
import type { ExperimentDefinition } from "@/domain/experiments/types";
import {
  analyteConcentrationFromTitration,
  molesFromMassAndMolarMass,
} from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";
import {
  projectStageConcordance,
  type TitrationPublicState,
} from "@/domain/simulation/titration/engine";
import type { TitrationExperimentConfig } from "@/domain/simulation/titration/config";
import { declaredQuestionsFor } from "@/domain/experiments/catalog/catalog-registry";
import { scoreReportAnswers } from "@/application/attempts/grade-attempt";
import type { AttemptGrade, CalculationVerdict, InstructorFeedbackItem } from "@/infrastructure/supabase/repositories/grades";

/**
 * Report data model for the student report route.
 *
 * PURE projection over PUBLIC data: the attempt's public snapshot, the
 * public catalog definition, the student's own report row, and the
 * student-visible grade/feedback rows. Every number shown is either a
 * recorded measurement or recomputed here through the domain chemistry
 * engine — the single source of truth for formulas. Hidden truth
 * (concentrations, endpoints, seeds) is never an input, so it cannot leak
 * into the rendered report.
 */

export interface ReportTrialRow {
  trialNumber: number;
  status: string;
  initialMl: number | null;
  finalMl: number | null;
  titreMl: number | null;
  reportedMolarityM: number | null;
  /** Grading verdict for the reported value, once the attempt is submitted. */
  correct: boolean | null;
  rejectionReason: string | null;
}

export interface ReportCalculationTrace {
  trialNumber: number;
  inputs: Array<{ label: string; value: string }>;
  formula: string;
  result: string | null;
  unit: string;
}

export interface ReportStageModel {
  key: string;
  title: string;
  analyteKind: "weighed_mass" | "pipetted_volume";
  khpMassG: number | null;
  aliquotMl: number | null;
  trials: ReportTrialRow[];
  concordant: boolean;
  spread: number | null;
  allowedSpread: number;
  spreadUnit: string;
  averageMolarityM: number | null;
  acceptedTrials: number[];
  discardedTrials: number[];
  detail: string;
  calculations: ReportCalculationTrace[];
  burettePrecisionMl: number;
  samplePrecision: { label: string; value: number; unit: string };
}

export interface ReportQuestionModel {
  key: string;
  prompt: string;
  answer: string;
  answered: boolean;
  awarded: number;
  max: number;
}

export interface AttemptReportModel {
  stages: ReportStageModel[];
  observations: Array<{ fieldKey: string; prompt: string; text: string }>;
  questions: ReportQuestionModel[];
  questionsTotal: number;
  questionsMax: number;
  standardizedNaohM: number | null;
  finalHclM: number | null;
  completionPercent: number;
  missingItems: string[];
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function buildReportModel(args: {
  definition: ExperimentDefinition;
  config: TitrationExperimentConfig;
  publicState: TitrationPublicState;
  report: {
    status: string;
    sections: { aim: string; procedure: string; resultsSummary: string; conclusion: string; safetyNotes: string };
    answers: Record<string, unknown>;
  };
  grade: AttemptGrade | null;
  verdicts: CalculationVerdict[];
  feedback: InstructorFeedbackItem[];
}): AttemptReportModel {
  const { definition, config, publicState } = args;
  const verdictByKey = new Map(args.verdicts.map((verdict) => [verdict.questionKey, verdict.correct]));

  const stages: ReportStageModel[] = config.stages.map((stageConfig) => {
    const stage = publicState.stages[stageConfig.key];
    const concordance = stage
      ? projectStageConcordance(config, stage)
      : null;
    const trials: ReportTrialRow[] = (stage?.trials ?? []).map((trial) => {
      const key = `${stageConfig.key}__molarity_trial_${trial.trialNumber}`;
      return {
        trialNumber: trial.trialNumber,
        status: trial.status,
        initialMl: trial.initialReadingMl,
        finalMl: trial.finalReadingMl,
        titreMl: trial.deliveredMl,
        reportedMolarityM: trial.reportedMolarityM,
        correct: verdictByKey.get(key) ?? null,
        rejectionReason: trial.rejectionReason,
      };
    });

    const khpMassG =
      stageConfig.analytePortion.kind === "weighed_mass" ? (stage?.analyteMassG ?? null) : null;
    const aliquotMl =
      stageConfig.analytePortion.kind === "pipetted_volume" ? (stage?.analyteVolumeMl ?? null) : null;

    const calculations: ReportCalculationTrace[] = (stage?.trials ?? [])
      .filter((trial) => trial.status === "recorded" && trial.deliveredMl !== null && trial.deliveredMl > 0)
      .map((trial) => {
        if (stageConfig.analytePortion.kind === "weighed_mass" && khpMassG !== null) {
          const moles = molesFromMassAndMolarMass(khpMassG, KHP_MOLAR_MASS_G_PER_MOL);
          const molarity = moles / ((trial.deliveredMl as number) / 1000);
          return {
            trialNumber: trial.trialNumber,
            inputs: [
              { label: "KHP mass", value: `${khpMassG} g` },
              { label: "KHP molar mass", value: `${KHP_MOLAR_MASS_G_PER_MOL} g/mol` },
              { label: "NaOH titre", value: `${trial.deliveredMl} mL` },
            ],
            formula: "n(KHP) = m / M;  M(NaOH) = n / V  (1:1)",
            result: `${round(molarity, 6)}`,
            unit: "mol/L",
          };
        }
        if (stageConfig.analytePortion.kind === "pipetted_volume" && aliquotMl !== null) {
          const standard = standardizedAverage(config, publicState);
          if (standard === null) {
            return {
              trialNumber: trial.trialNumber,
              inputs: [
                { label: "HCl aliquot", value: `${aliquotMl} mL` },
                { label: "NaOH titre", value: `${trial.deliveredMl} mL` },
              ],
              formula: "M(HCl) = M(NaOH) × V(NaOH) / V(HCl)  (1:1)",
              result: null,
              unit: "mol/L",
            };
          }
          const molarity = analyteConcentrationFromTitration({
            titrantMolarityMolPerL: standard,
            titrantVolumeValue: trial.deliveredMl as number,
            titrantVolumeUnit: "mL",
            analyteVolumeValue: aliquotMl,
            analyteVolumeUnit: "mL",
            stoichiometry: {
              analyteCoefficient: stageConfig.stoichiometry.analyteCoefficient,
              titrantCoefficient: stageConfig.stoichiometry.titrantCoefficient,
            },
          });
          return {
            trialNumber: trial.trialNumber,
            inputs: [
              { label: "Standardised NaOH", value: `${standard} mol/L` },
              { label: "NaOH titre", value: `${trial.deliveredMl} mL` },
              { label: "HCl aliquot", value: `${aliquotMl} mL` },
            ],
            formula: "M(HCl) = M(NaOH) × V(NaOH) / V(HCl)  (1:1)",
            result: `${round(molarity, 6)}`,
            unit: "mol/L",
          };
        }
        return {
          trialNumber: trial.trialNumber,
          inputs: [],
          formula: "",
          result: null,
          unit: "mol/L",
        };
      });

    const portion = stageConfig.analytePortion;
    return {
      key: stageConfig.key,
      title: stageConfig.title,
      analyteKind: portion.kind,
      khpMassG,
      aliquotMl,
      trials,
      concordant: concordance?.concordant ?? false,
      spread: concordance?.spread ?? null,
      allowedSpread: concordance?.allowedSpread ?? 0,
      spreadUnit: concordance?.spreadUnit ?? "mol/L",
      averageMolarityM: concordance?.averageMolarityM ?? null,
      acceptedTrials:
        stage?.trials.filter((t) => t.status === "recorded").map((t) => t.trialNumber) ?? [],
      discardedTrials: concordance?.discardedTrials ?? [],
      detail: concordance?.detail ?? "",
      calculations,
      burettePrecisionMl: stageConfig.burette.readingPrecisionMl,
      samplePrecision:
        portion.kind === "weighed_mass"
          ? { label: "Balance", value: portion.balancePrecisionG, unit: "g" }
          : { label: "Measuring cylinder", value: portion.volumePrecisionMl, unit: "mL" },
    };
  });

  const observationPrompts = new Map(
    definition.observations.map((observation) => [observation.fieldKey, observation.prompt]),
  );
  const observations = publicState.observations.map((stored) => ({
    fieldKey: stored.fieldKey,
    prompt: observationPrompts.get(stored.fieldKey) ?? stored.fieldKey,
    text: stored.textValue,
  }));

  const scoring = scoreReportAnswers(declaredQuestionsFor(definition.id), args.report.answers);
  const scoreByKey = new Map(scoring.perQuestion.map((entry) => [entry.key, entry]));
  const questions: ReportQuestionModel[] = declaredQuestionsFor(definition.id).map((question) => {
    const raw = args.report.answers[question.key];
    const score = scoreByKey.get(question.key);
    return {
      key: question.key,
      prompt: question.prompt,
      answer: typeof raw === "string" ? raw : "",
      answered: typeof raw === "string" && raw.trim().length > 0,
      awarded: score?.awarded ?? 0,
      max: question.points,
    };
  });

  const standardizedNaohM = stages.length > 0 ? (stages[0].averageMolarityM ?? null) : null;
  const finalHclM = stages.length > 1 ? (stages[stages.length - 1].averageMolarityM ?? null) : null;

  // Completion checklist: bench work, reporting, questions, conclusion.
  const missingItems: string[] = [];
  for (const stageModel of stages) {
    if (!stageModel.concordant) missingItems.push(`${stageModel.title}: concordance not reached`);
    const unreported = stageModel.trials.filter(
      (trial) => trial.status === "recorded" && trial.reportedMolarityM === null,
    );
    for (const trial of unreported) {
      missingItems.push(`${stageModel.title} trial ${trial.trialNumber}: concentration not reported`);
    }
  }
  const requiredObservations = definition.observations.filter((field) => field.isRequired);
  for (const field of requiredObservations) {
    if (!observations.some((stored) => stored.fieldKey === field.fieldKey)) {
      missingItems.push(`Observation missing: ${field.prompt}`);
    }
  }
  for (const question of questions) {
    if (!question.answered) missingItems.push(`Question unanswered: ${question.key}`);
  }
  if (args.report.sections.conclusion.trim().length === 0) {
    missingItems.push("Conclusion not written");
  }
  const totalChecks =
    stages.length * 2 +
    stages.reduce((sum, stageModel) => sum + stageModel.trials.filter((t) => t.status === "recorded").length, 0) +
    requiredObservations.length +
    questions.length +
    1;
  const completionPercent =
    totalChecks === 0 ? 0 : Math.round(((totalChecks - missingItems.length) / totalChecks) * 100);

  return {
    stages,
    observations,
    questions,
    questionsTotal: scoring.total,
    questionsMax: scoring.max,
    standardizedNaohM,
    finalHclM,
    completionPercent,
    missingItems,
  };
}

/** Standardised titrant average from the first (KHP) stage, if concordant. */
function standardizedAverage(
  config: TitrationExperimentConfig,
  publicState: TitrationPublicState,
): number | null {
  const first = config.stages[0];
  const stage = first ? publicState.stages[first.key] : undefined;
  if (!stage) return null;
  return projectStageConcordance(config, stage).averageMolarityM;
}
