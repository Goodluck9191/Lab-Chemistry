import "server-only";
import { ATTEMPT_STATUS_LABELS, type AttemptStatus } from "@/domain/attempts";
import { molarMassForChemical } from "@/domain/chemistry/molar-masses";
import {
  declaredCalculationPromptsFor,
  declaredObservationFieldsFor,
  type DeclaredCalculation,
  type DeclaredObservationField,
} from "@/domain/experiments/catalog/catalog-registry";
import type { ExperimentBriefing, ProcedureStep } from "@/domain/experiments/types";
import { toPublicJSON, type TitrationPublicState } from "@/domain/simulation/titration/engine";
import {
  projectExperimentWorkflow,
  type ExperimentWorkflowStatus,
} from "@/domain/simulation/titration/workflow";
import {
  publicTitrationConfigView,
  type PublicStageView,
  type PublicTitrationConfigView,
} from "@/domain/simulation/titration/public-view";
import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import { getExperimentBriefing } from "@/infrastructure/supabase/repositories/experiments";
import { getReportForAttempt } from "@/infrastructure/supabase/repositories/attempts";
import { loadTitrationAttempt } from "./apply-simulation-action";
import { catalogNotices } from "./catalog-coverage";
import { attemptIdSchema } from "./schemas";

/**
 * The complete, safe payload the laboratory UI renders from.
 *
 * SECURITY: this object is assembled field by field from (a) the engine's public
 * projection, (b) the whitelisted public configuration and (c) the public
 * experiment catalog. The engine session (which carries the hidden reality) and
 * `attempt_secrets` never appear in it, and the type makes that visible: there is
 * no field that could hold a seed, a true concentration or an endpoint volume.
 */

/** One server-gradable calculation: the molarity the student reports per trial. */
export interface LabCalculationPrompt {
  questionKey: string;
  stageKey: string;
  stageTitle: string;
  trialNumber: number;
  /** UI copy describing what to submit; contains no answer and no hidden value. */
  label: string;
  unit: string;
}

/**
 * Formula scaffolding derived from the configuration: the reaction equation and
 * the stoichiometry it declares, plus the unit convention. It deliberately
 * carries no expected value.
 */
export interface LabFormulaGuidance {
  stageKey: string;
  stageTitle: string;
  reactionEquation: string;
  stoichiometry: { analyteCoefficient: number; titrantCoefficient: number };
  analyteKey: string;
  titrantKey: string;
  /** Reference molar mass for the weighed analyte, when the domain has one. */
  analyteMolarMassGPerMol: number | null;
}

/**
 * The student's report write-up as the browser may see it. `readingsSnapshot`
 * is deliberately ABSENT: the frozen copy duplicates the public projection the
 * UI already holds, so sending it again would only bloat the payload.
 */
export interface LabReportView {
  status: "draft" | "submitted" | "reviewed";
  aim: string;
  procedure: string;
  resultsSummary: string;
  conclusion: string;
  safetyNotes: string;
  /** Student's report-question answers, keyed by question key. Student data only. */
  answers: Record<string, string>;
  submittedAt: string | null;
}

export interface LabStateView {
  attemptId: string;
  experimentId: string;
  experimentNumber: number;
  experimentTitle: string;
  attemptStatus: AttemptStatus;
  attemptStatusLabel: string;
  /** False once the attempt is submitted/graded/abandoned: the lab is read-only. */
  canWrite: boolean;
  /** Autosave revision the client must base its next action on. */
  revision: number;
  accuracy: ExperimentBriefing["accuracy"];
  /** Names from the PUBLIC catalog, keyed by chemical/apparatus key. */
  chemicalLabels: Record<string, string>;
  apparatusLabels: Record<string, string>;
  config: PublicTitrationConfigView;
  publicState: TitrationPublicState;
  /**
   * Explicit experiment workflow (stage order, locks, checklist, submit gate),
   * derived server-side from the public projection on every read.
   */
  workflow: ExperimentWorkflowStatus;
  /** The student's report draft, if one exists. Never carries hidden values. */
  report: LabReportView | null;
  procedure: ProcedureStep[];
  declaredObservations: DeclaredObservationField[];
  /** Declared prompts the protocol cannot grade yet (e.g. the moles step). */
  ungradedCalculations: DeclaredCalculation[];
  calculationPrompts: LabCalculationPrompt[];
  formulaGuidance: LabFormulaGuidance[];
  /**
   * Honest, runtime-derived statements about gaps between the public catalog and
   * the simulation configuration. These explain missing apparatus or reagents
   * instead of inventing them.
   */
  notices: string[];
}

function calculationPromptsFor(
  stage: PublicStageView,
  publicState: TitrationPublicState,
): LabCalculationPrompt[] {
  const session = publicState.stages[stage.key];
  if (!session) return [];
  const trialNumbers = [
    ...session.trials.filter((trial) => trial.status === "recorded").map((t) => t.trialNumber),
  ].sort((a, b) => a - b);
  return trialNumbers.map((trialNumber) => ({
    questionKey: `${stage.key}__molarity_trial_${trialNumber}`,
    stageKey: stage.key,
    stageTitle: stage.title,
    trialNumber,
    label: `Concentration of the titrant (${stage.titrantKey}) from ${stage.title}, trial ${trialNumber}`,
    unit: "mol/L",
  }));
}

function formulaGuidanceFor(stage: PublicStageView): LabFormulaGuidance {
  return {
    stageKey: stage.key,
    stageTitle: stage.title,
    reactionEquation: stage.reactionEquation,
    stoichiometry: { ...stage.stoichiometry },
    analyteKey: stage.analyteKey,
    titrantKey: stage.titrantKey,
    analyteMolarMassGPerMol:
      stage.analytePortion.kind === "weighed_mass"
        ? molarMassForChemical(stage.analyteKey)
        : null,
  };
}

/** Everything the view needs, already loaded and already safe to serialise. */
export interface LabStateSources {
  attemptId: string;
  experimentId: string;
  status: AttemptStatus;
  /** False once the attempt is frozen: the lab renders read-only. */
  canWrite: boolean;
  revision: number;
  /** Whitelisted public configuration view. */
  config: PublicTitrationConfigView;
  /** The engine's public projection — never the session. */
  publicState: TitrationPublicState;
  /** The student's report draft, if one exists. */
  report: LabReportView | null;
  /** Public experiment catalog projection. */
  briefing: ExperimentBriefing;
}

/**
 * Assemble the laboratory payload FIELD BY FIELD from public sources.
 *
 * This is the single place the UI's payload shape is decided, so the read path,
 * the tests and the development-only preview harness all render from exactly the
 * same object. There is no field here that could hold a seed, a true
 * concentration or an endpoint volume: the inputs are the public projection, the
 * whitelisted configuration and the public catalog.
 */
export function buildLabStateView(sources: LabStateSources): LabStateView {
  const { briefing, config, publicState } = sources;
  const declaredObservations = declaredObservationFieldsFor(sources.experimentId);
  const workflow = projectExperimentWorkflow(
    config,
    publicState,
    declaredObservations
      .filter((field) => field.isRequired)
      .map((field) => ({ fieldKey: field.fieldKey, prompt: field.prompt })),
  );
  return {
    attemptId: sources.attemptId,
    experimentId: sources.experimentId,
    experimentNumber: briefing.number,
    experimentTitle: briefing.title,
    attemptStatus: sources.status,
    attemptStatusLabel: ATTEMPT_STATUS_LABELS[sources.status],
    canWrite: sources.canWrite,
    revision: sources.revision,
    accuracy: briefing.accuracy,
    chemicalLabels: Object.fromEntries(
      briefing.chemicals.map((chemical) => [chemical.key, chemical.name]),
    ),
    apparatusLabels: Object.fromEntries(
      briefing.apparatus.map((item) => [item.key, item.name]),
    ),
    config,
    publicState,
    workflow,
    report: sources.report,
    procedure: briefing.procedure,
    declaredObservations: declaredObservationFieldsFor(sources.experimentId),
    ungradedCalculations: declaredCalculationPromptsFor(sources.experimentId),
    calculationPrompts: config.stages.flatMap((stage) =>
      calculationPromptsFor(stage, publicState),
    ),
    formulaGuidance: config.stages.map(formulaGuidanceFor),
    notices: catalogNotices(briefing, config),
  };
}

/**
 * Load everything the laboratory needs for one attempt.
 *
 * Ownership, writability, hidden-state loading and snapshot resumption are all
 * delegated to `loadTitrationAttempt`, so the read path and the write path can
 * never disagree about an attempt. Throws when the attempt is missing, belongs
 * to someone else, or is not a titration simulation.
 */
export async function getLabState(rawAttemptId: string): Promise<LabStateView> {
  const attemptId = attemptIdSchema.parse(rawAttemptId);
  const loaded = await loadTitrationAttempt(attemptId);

  const supabase = await createServerSupabaseClient();
  const briefing = await getExperimentBriefing(supabase, loaded.experimentId);
  if (!briefing) throw new Error(`Experiment ${loaded.experimentId} was not found`);

  const storedReport = await getReportForAttempt(supabase, attemptId);

  return buildLabStateView({
    attemptId: loaded.attemptId,
    experimentId: loaded.experimentId,
    status: loaded.status,
    canWrite: loaded.canWrite,
    revision: loaded.revision,
    config: publicTitrationConfigView(loaded.config),
    publicState: toPublicJSON(loaded.session),
    report: storedReport
      ? {
          status: storedReport.status,
          aim: storedReport.aim,
          procedure: storedReport.procedure,
          resultsSummary: storedReport.resultsSummary,
          conclusion: storedReport.conclusion,
          safetyNotes: storedReport.safetyNotes,
          answers: Object.fromEntries(
            Object.entries(storedReport.answers).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          submittedAt: storedReport.submittedAt,
        }
      : null,
    briefing,
  });
}
