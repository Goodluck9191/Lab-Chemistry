/**
 * Experiment workflow: the explicit, server-authoritative state machine for a
 * complete titration practical.
 *
 * WHY THIS EXISTS: the engine knows how to run one titration, and the snapshot
 * knows which trials are recorded, but nothing said "Stage B unlocks only when
 * Stage A is concordant" or "this attempt may be submitted". That ordering used
 * to live implicitly in the UI's stage switcher (which let a student open Stage
 * B on the first click). This module makes the workflow EXPLICIT and DERIVED:
 *
 * - the single source of truth is the persisted public session (the snapshot);
 * - this projection recomputes the checklist from it on every read, so it can
 *   never be stale, client-authored, or out of sync with the trials;
 * - `dispatchTitrationAction` enforces the stage order server-side, and the
 *   submit use case enforces the completion gate server-side.
 *
 * Nothing hidden is read here: concordance, trials and observations are all
 * public. Stage letters (A, B, ...) are display labels derived from order.
 */
import type { TitrationPublicState } from "./engine";

/** Minimal stage description; both the full config and the public view satisfy it. */
export interface WorkflowStageInput {
  readonly key: string;
  readonly title: string;
  readonly analytePortion: { readonly kind: "weighed_mass" | "pipetted_volume" };
}

/** Minimal config description; both the full config and the public view satisfy it. */
export interface WorkflowConfigInput {
  readonly stages: readonly WorkflowStageInput[];
}

/** One required observation prompt the submit gate checks for. */
export interface WorkflowRequiredObservation {
  readonly fieldKey: string;
  readonly prompt: string;
}

export interface StageRequirement {
  readonly key: "prepare" | "trials" | "report" | "concordance";
  readonly label: string;
  readonly done: boolean;
}

export interface StageWorkflowStatus {
  readonly key: string;
  readonly title: string;
  readonly index: number;
  /** Display letter derived from order ("A", "B", ...). */
  readonly letter: string;
  /** True while an earlier stage is still incomplete: actions there are rejected. */
  readonly locked: boolean;
  readonly lockedByKey: string | null;
  readonly lockedByTitle: string | null;
  /** True exactly when the stage concordance is satisfied. */
  readonly complete: boolean;
  readonly prepared: boolean;
  readonly recordedTrials: number;
  readonly requiredTrials: number;
  readonly maxTrials: number;
  readonly reportedTrials: number;
  readonly concordant: boolean;
  readonly averageMolarityM: number | null;
  readonly requirements: readonly StageRequirement[];
}

export interface ExperimentWorkflowStatus {
  readonly stages: readonly StageWorkflowStatus[];
  /** First incomplete stage, otherwise the last configured stage. */
  readonly activeStageKey: string;
  readonly allStagesComplete: boolean;
  readonly recordedTrials: number;
  readonly requiredTrials: number;
  readonly percent: number;
  readonly label: string;
  /** Required observation prompts with no stored observation yet. */
  readonly missingObservations: readonly WorkflowRequiredObservation[];
  /** Every unmet submit requirement, in student-facing words. Empty means submittable. */
  readonly blockers: readonly string[];
  readonly canSubmit: boolean;
}

function stageLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function projectStage(
  stageInput: WorkflowStageInput,
  index: number,
  publicState: TitrationPublicState,
  lockedBy: StageWorkflowStatus | null,
): StageWorkflowStatus {
  const session = publicState.stages[stageInput.key];
  const concordance = session?.concordance;
  const recorded = session?.trials.filter((trial) => trial.status === "recorded") ?? [];
  const unreported = recorded.filter((trial) => trial.reportedMolarityM === null);
  const analyteReady =
    stageInput.analytePortion.kind === "weighed_mass"
      ? session?.analyteMassG !== null && session?.analyteMassG !== undefined
      : session?.analyteVolumeMl !== null && session?.analyteVolumeMl !== undefined;
  const prepared =
    (session?.apparatusReady ?? false) && analyteReady && (session?.indicatorDrops ?? null) !== null;
  const requiredTrials = concordance?.requiredTrials ?? 0;
  const concordant = concordance?.concordant ?? false;
  const reportedTrials = recorded.length - unreported.length;

  const requirements: StageRequirement[] = [
    {
      key: "prepare",
      label: "Prepare the apparatus, sample and indicator",
      done: prepared,
    },
    {
      key: "trials",
      label: `Record ${requiredTrials} trials (${recorded.length} of ${requiredTrials} recorded)`,
      done: recorded.length >= requiredTrials,
    },
    {
      key: "report",
      label:
        unreported.length === 0
          ? "Report a concentration for every recorded trial"
          : `Report a concentration for every recorded trial (trial ${unreported.map((t) => t.trialNumber).join(", ")} missing)`,
      done: recorded.length > 0 && unreported.length === 0,
    },
    {
      key: "concordance",
      label: concordance
        ? `Reach concordance (spread within ${concordance.allowedSpread} ${concordance.spreadUnit})`
        : "Reach concordance",
      done: concordant,
    },
  ];

  return {
    key: stageInput.key,
    title: stageInput.title,
    index,
    letter: stageLetter(index),
    locked: lockedBy !== null,
    lockedByKey: lockedBy?.key ?? null,
    lockedByTitle: lockedBy?.title ?? null,
    complete: concordant,
    prepared,
    recordedTrials: recorded.length,
    requiredTrials,
    maxTrials: concordance?.maxTrials ?? 0,
    reportedTrials,
    concordant,
    averageMolarityM: concordance?.averageMolarityM ?? null,
    requirements,
  };
}

/**
 * Project the experiment workflow from public state. Pure and total: a stage
 * missing from the snapshot projects as not started rather than throwing, so a
 * partially-written document still yields an honest checklist.
 */
export function projectExperimentWorkflow(
  config: WorkflowConfigInput,
  publicState: TitrationPublicState,
  requiredObservations: readonly WorkflowRequiredObservation[] = [],
): ExperimentWorkflowStatus {
  const stages: StageWorkflowStatus[] = [];
  let firstIncomplete: StageWorkflowStatus | null = null;
  for (const [index, stageInput] of config.stages.entries()) {
    const status = projectStage(stageInput, index, publicState, firstIncomplete);
    stages.push(status);
    // A later stage locks behind the FIRST incomplete earlier stage, so the
    // student always sees exactly which stage unblocks their work.
    if (firstIncomplete === null && !status.complete) {
      firstIncomplete = status;
    }
  }

  const activeStage = stages.find((stage) => !stage.complete) ?? stages[stages.length - 1];
  const recordedTrials = stages.reduce((total, stage) => total + stage.recordedTrials, 0);
  const requiredTrials = stages.reduce((total, stage) => total + stage.requiredTrials, 0);

  const missingObservations = requiredObservations.filter(
    (required) =>
      !publicState.observations.some((stored) => stored.fieldKey === required.fieldKey),
  );

  const blockers: string[] = [];
  for (const stage of stages) {
    for (const requirement of stage.requirements) {
      if (!requirement.done) {
        blockers.push(`Stage ${stage.letter} (${stage.title}): ${requirement.label}.`);
      }
    }
  }
  for (const missing of missingObservations) {
    blockers.push(`Record the observation: ${missing.prompt}`);
  }

  return {
    stages,
    activeStageKey: activeStage?.key ?? "",
    allStagesComplete: stages.length > 0 && stages.every((stage) => stage.complete),
    recordedTrials,
    requiredTrials,
    percent: requiredTrials === 0 ? 0 : Math.round((recordedTrials / requiredTrials) * 100),
    label: `${recordedTrials} of ${requiredTrials} required trials recorded`,
    missingObservations,
    blockers,
    canSubmit: blockers.length === 0,
  };
}
