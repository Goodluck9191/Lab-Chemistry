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
import type { SolutionDilutionConfig } from "./config";
import {
  REQUIRED_BEAKER_RINSES,
  REQUIRED_CONDITIONING_RINSES,
  emptyWorkingSolution,
  solutionPreparationBlockers,
  type TitrationPublicState,
} from "./engine";

/** Minimal stage description; both the full config and the public view satisfy it. */
export interface WorkflowStageInput {
  readonly key: string;
  readonly title: string;
  readonly analytePortion: { readonly kind: "weighed_mass" | "pipetted_volume" };
}

/** Minimal config description; both the full config and the public view satisfy it. */
export interface WorkflowConfigInput {
  /** Part I working-titrant dilution, or null when the titrant is ready-made. */
  readonly solutionDilution: SolutionDilutionConfig | null;
  readonly stages: readonly WorkflowStageInput[];
}

/** One required observation prompt the submit gate checks for. */
export interface WorkflowRequiredObservation {
  readonly fieldKey: string;
  readonly prompt: string;
}

export interface StageRequirement {
  readonly key:
    | "prepare_solution"
    | "prepare_burette"
    | "prepare_sample"
    | "prepare_flask"
    | "trials"
    | "report"
    | "concordance";
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
  /**
   * Part I requirement, attached to the FIRST stage only.
   *
   * The working solution belongs to the attempt, not to a stage, but the
   * checklist is per stage: showing it once, ahead of the stage it unblocks,
   * keeps one honest list instead of repeating the same blocker for every stage.
   */
  solutionRequirement: StageRequirement | null,
): StageWorkflowStatus {
  const session = publicState.stages[stageInput.key];
  const prep = session?.preparation;
  const concordance = session?.concordance;
  const recorded = session?.trials.filter((trial) => trial.status === "recorded") ?? [];
  const unreported = recorded.filter((trial) => trial.reportedMolarityM === null);
  const analyteReady =
    stageInput.analytePortion.kind === "weighed_mass"
      ? session?.analyteMassG !== null && session?.analyteMassG !== undefined
      : session?.analyteVolumeMl !== null && session?.analyteVolumeMl !== undefined;
  const buretteReady =
    (session?.apparatusReady ?? false) && (session?.buretteInitialMl ?? null) !== null;
  const requiredTrials = concordance?.requiredTrials ?? 0;
  const concordant = concordance?.concordant ?? false;
  const reportedTrials = recorded.length - unreported.length;

  const buretteMissing: string[] = [];
  if (!prep?.buretteCleaned) buretteMissing.push("clean the burette");
  if ((prep?.conditioningRinses ?? 0) < REQUIRED_CONDITIONING_RINSES) {
    buretteMissing.push(
      `condition it (${prep?.conditioningRinses ?? 0} of ${REQUIRED_CONDITIONING_RINSES} rinses)`,
    );
  }
  if (!buretteReady) buretteMissing.push("fill it and record the initial reading");
  if (!prep?.airBubbleCleared) buretteMissing.push("clear the air bubble from the tip");

  const sampleMissing: string[] = [];
  if (stageInput.analytePortion.kind === "weighed_mass") {
    if (prep?.beakerMassG === null || prep?.beakerMassG === undefined) {
      sampleMissing.push("weigh the empty beaker");
    }
    if (prep?.beakerPlusKhpMassG === null || prep?.beakerPlusKhpMassG === undefined) {
      sampleMissing.push("add KHP and weigh again");
    }
    if (!prep?.khpDissolved) sampleMissing.push("dissolve the KHP");
    if (!prep?.khpTransferred) sampleMissing.push("transfer the solution to the flask");
    if ((prep?.beakerRinses ?? 0) < REQUIRED_BEAKER_RINSES) {
      sampleMissing.push(
        `rinse the beaker (${prep?.beakerRinses ?? 0} of ${REQUIRED_BEAKER_RINSES} rinses)`,
      );
    }
  } else if (!analyteReady) {
    sampleMissing.push("measure the aliquot volume");
  }

  const flaskMissing: string[] = [];
  if ((session?.indicatorDrops ?? null) === null) flaskMissing.push("add the indicator");
  if (!prep?.flaskPlaced) flaskMissing.push("place the flask under the burette");

  const prepared =
    buretteMissing.length === 0 &&
    sampleMissing.length === 0 &&
    flaskMissing.length === 0 &&
    // The first stage is not "prepared" while the solution the burette is
    // filled from is still missing.
    (index !== 0 || solutionRequirement === null || solutionRequirement.done);

  const requirements: StageRequirement[] = [
    ...(index === 0 && solutionRequirement ? [solutionRequirement] : []),
    {
      key: "prepare_burette",
      label:
        buretteMissing.length === 0
          ? "Burette cleaned, conditioned, filled and cleared"
          : `Prepare the burette: ${buretteMissing.join("; ")}.`,
      done: buretteMissing.length === 0,
    },
    {
      key: "prepare_sample",
      label:
        sampleMissing.length === 0
          ? "Sample prepared and transferred"
          : `Prepare the sample: ${sampleMissing.join("; ")}.`,
      done: sampleMissing.length === 0,
    },
    {
      key: "prepare_flask",
      label:
        flaskMissing.length === 0
          ? "Indicator added, flask placed"
          : `Ready the flask: ${flaskMissing.join("; ")}.`,
      done: flaskMissing.length === 0,
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
  const solution = publicState.solution ?? emptyWorkingSolution();
  const solutionBlockers = solutionPreparationBlockers(config, solution);
  const solutionRequirement: StageRequirement | null = config.solutionDilution
    ? {
        key: "prepare_solution",
        label:
          solutionBlockers.length === 0
            ? "Working solution prepared from the stock solution"
            : `Prepare the working solution: ${solutionBlockers.join("; ")}`,
        done: solutionBlockers.length === 0,
      }
    : null;

  const stages: StageWorkflowStatus[] = [];
  let firstIncomplete: StageWorkflowStatus | null = null;
  for (const [index, stageInput] of config.stages.entries()) {
    const status = projectStage(
      stageInput,
      index,
      publicState,
      firstIncomplete,
      solutionRequirement,
    );
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
