/**
 * Laboratory view model — PURE functions, no React, no DOM, no chemistry.
 *
 * Everything the bench, the procedure panel and the data panels display is
 * derived here from two authoritative inputs:
 *
 *   1. the engine's PUBLIC state (`TitrationPublicState`), and
 *   2. the whitelisted public CONFIGURATION (`PublicTitrationConfigView`).
 *
 * The module never computes a chemistry result, never predicts an endpoint and
 * never invents a value that is not already in one of those two inputs. That is
 * what lets the React components stay dumb and the rules stay testable in a
 * plain Node test run.
 */
import type { FlaskColour } from "@/domain/simulation/titration/endpoint";
import type {
  PublicStageView,
  PublicTitrationConfigView,
} from "@/domain/simulation/titration/public-view";
import {
  emptyPreparation,
  emptyWorkingSolution,
  preparationBlockersForTrial,
  solutionPreparationBlockers,
} from "@/domain/simulation/titration/engine";
import type {
  StageConcordance,
  StagePreparation,
  StageSession,
  TitrationPublicState,
  WorkingSolutionPreparation,
} from "@/domain/simulation/titration/engine";

export type SessionPhase = StageSession["phase"];

/** Which control the procedure panel asks for next. */
export type NextActionKind =
  | "setup_apparatus"
  | "weigh_analyte"
  | "pipette_analyte"
  | "add_indicator"
  | "start_trial"
  | "add_titrant"
  | "read_burette"
  | "complete_trial"
  | "report_molarity"
  | "record_observation"
  | "stage_complete"
  | "review_submit"
  | "measure_stock"
  | "dilute_solution"
  | "mix_solution"
  | "obtain_naoh_portion"
  | "rinse_burette"
  | "condition_burette"
  | "weigh_beaker"
  | "clear_air_bubble"
  | "dissolve_khp"
  | "transfer_solution"
  | "rinse_beaker"
  | "place_flask"
  | "discard_to_waste"
  | "read_only";

export interface NextAction {
  kind: NextActionKind;
  title: string;
  description: string;
}

export interface PreparationStepView {
  key: string;
  label: string;
  detail: string;
  requires: string[];
  done: boolean;
  current: boolean;
}

/**
 * Which piece of ware the procedure transfers a measured aliquot with, named by
 * its apparatus key so the laboratory can show the catalog's own name.
 */
export type PortionVessel = "graduated_cylinder" | "pipette";

/**
 * Part I: the working titrant, prepared from stock before any burette work.
 *
 * Session-level, because the one prepared solution serves every stage. `required`
 * is false when the experiment is given a ready-made titrant, and the section is
 * then not rendered at all.
 */
export interface SolutionView {
  required: boolean;
  /** Chemical key of the stock solution, or null when there is no dilution. */
  stockKey: string | null;
  stockMolarityM: number | null;
  nominalWorkingMolarityM: number | null;
  /** Volume the student measured, or null before that step. Evidence only. */
  stockVolumeMl: number | null;
  diluted: boolean;
  mixed: boolean;
  ready: boolean;
  steps: PreparationStepView[];
  /** Part I readiness messages in procedure order; empty means prepared. */
  blockers: string[];
  nextAction: NextAction | null;
}

export interface TrialRowView {
  trialNumber: number;
  status: StageSession["trials"][number]["status"];
  statusLabel: string;
  statusTone: "neutral" | "success" | "warning" | "danger";
  initialReadingMl: number | null;
  finalReadingMl: number | null;
  titreMl: number | null;
  observedColour: FlaskColour | null;
  observationLabel: string;
  reportedMolarityM: number | null;
  rejectionReason: string | null;
  isOpen: boolean;
}

export interface FlaskView {
  colour: FlaskColour | null;
  label: string;
  description: string;
  tone: "neutral" | "success" | "warning";
  /** True when the flask holds a partially titrated solution. */
  hasContents: boolean;
}

export interface BuretteView {
  capacityMl: number;
  graduationMl: number;
  readingPrecisionMl: number;
  /** Scale value at the liquid surface (mL from the top), null before setup. */
  readingMl: number | null;
  /** 0..1 fraction of the burette still full, for drawing only. */
  fillFraction: number;
  /** True once the burette has been rinsed, filled and clamped. */
  setup: boolean;
}

export interface ConcordanceView {
  mode: StageConcordance["mode"];
  status: "not_started" | "insufficient_evidence" | "concordant" | "not_concordant";
  spread: number | null;
  allowedSpread: number;
  spreadUnit: StageConcordance["spreadUnit"];
  detail: string;
  recordedTrials: number;
  requiredTrials: number;
  maxTrials: number;
  trialsStillNeeded: number;
  averageMolarityM: number | null;
  discardedTrials: number[];
  acceptedTrialNumbers: number[];
  reportedMolarityM: number[];
  /** UI copy, derived from the numbers above. No hidden value. */
  summary: string;
}

export interface StageView {
  key: string;
  index: number;
  title: string;
  reactionEquation: string;
  titrantKey: string;
  analyteKey: string;
  isActive: boolean;
  complete: boolean;
  /**
   * True while an earlier stage is still incomplete. The server refuses actions
   * on a locked stage (`stage_locked`); the bench shows the lock instead of
   * letting the student discover it through a rejection.
   */
  locked: boolean;
  /** Title of the stage that must be completed first, else null. */
  lockedBy: string | null;
  phase: SessionPhase;
  preparation: PreparationStepView[];
  nextAction: NextAction | null;
  flask: FlaskView;
  burette: BuretteView;
  indicator: {
    key: string;
    name: string;
    dropsRange: [number, number];
    dropsAdded: number | null;
    /** How long the endpoint colour must persist (manual: 45 to 60 s). */
    persistenceSeconds: [number, number];
  };
  portion:
    | { kind: "weighed_mass"; recordedMassG: number | null; nominalMassG: number; precision: number }
    | {
        kind: "pipetted_volume";
        recordedVolumeMl: number | null;
        nominalVolumeMl: number;
        precision: number;
        /** The procedure's ware for the aliquot: a cylinder, or a pipette. */
        vessel: PortionVessel;
      };
  openTrial: TrialRowView | null;
  trials: TrialRowView[];
  nextTrialNumber: number | null;
  deliveredMl: number;
  concordance: ConcordanceView;
  /**
   * Procedure preparation, straight from the persisted session: cleaning,
   * conditioning, weighings, dissolution, transfer, rinses, placement and
   * waste disposal. The bench reads it; it never computes it.
   */
  preparationState: StagePreparation;
  /** Trial-1 readiness messages in procedure order; empty means ready. */
  trialBlockers: string[];
  /** True once at least one trial has been completed on this stage. */
  hasCompletedTrial: boolean;
}

export interface LabViewModel {
  activeStageKey: string;
  /** Part I: the working titrant, ahead of every stage. */
  solution: SolutionView;
  stages: StageView[];
  progress: {
    recordedTrials: number;
    requiredTrials: number;
    percent: number;
    label: string;
  };
  /** UI-only flag: the bench should reconcile before further actions. */
  notices: string[];
}

export interface LabViewModelInput {
  config: PublicTitrationConfigView;
  publicState: TitrationPublicState;
  /** Chemical/apparatus names from the PUBLIC catalog; keys may be missing. */
  chemicalLabels: Record<string, string>;
  apparatusLabels: Record<string, string>;
  /** Stage the student explicitly selected, or null to use the derived one. */
  selectedStageKey: string | null;
  /** False when the attempt is frozen: the bench shows no controls. */
  canWrite: boolean;
}

/**
 * The one vocabulary for the four observable flask colours. Exported so the
 * action-feedback stream describes a colour exactly the way the bench does.
 */
export const FLASK_COLOUR_LABELS: Record<FlaskColour, string> = {
  colourless: "Colourless",
  faint_pink: "Faint pink",
  pink: "Pink",
  deep_pink: "Deep pink",
};

const FLASK_COLOUR_DESCRIPTIONS: Record<FlaskColour, string> = {
  colourless: "No colour change yet: the solution is still acid.",
  faint_pink: "A faint pink that persists marks the endpoint.",
  pink: "Clearly pink: past the faint pink of the endpoint.",
  deep_pink: "Strongly pink: the endpoint has been passed.",
};

/**
 * Student-facing wording for the two possible aliquot vessels.
 *
 * The procedure states which piece of ware it uses, and the two are not
 * interchangeable in a practical, so the wording comes from the CONFIGURATION
 * rather than from an assumption in a component.
 */
export const ALIQUOT_VESSEL_COPY: Record<
  PortionVessel,
  { name: string; stepLabel: string; detail: string; nextTitle: string; nextDescription: string }
> = {
  graduated_cylinder: {
    name: "measuring cylinder",
    stepLabel: "Measure the aliquot with the cylinder",
    detail:
      "Pour the solution into the measuring cylinder to the mark, transfer it into the flask, then record the volume you delivered.",
    nextTitle: "Measure the aliquot",
    nextDescription:
      "Measure the aliquot in the cylinder, transfer it into the conical flask and record the volume delivered.",
  },
  pipette: {
    name: "pipette",
    stepLabel: "Pipette the aliquot into the flask",
    detail:
      "Rinse the pipette with the solution, then deliver the aliquot using the pipette filler.",
    nextTitle: "Pipette the aliquot",
    nextDescription:
      "Fill the pipette with the filler, wipe the tip, then deliver it into the conical flask and record the volume.",
  },
};

const TRIAL_STATUS_LABELS: Record<TrialRowView["status"], string> = {
  open: "In progress",
  recorded: "Recorded",
  rejected: "Rejected",
  discarded_overshoot: "Rejected (overshot)",
};

const TRIAL_STATUS_TONES: Record<TrialRowView["status"], TrialRowView["statusTone"]> = {
  open: "neutral",
  recorded: "success",
  rejected: "danger",
  discarded_overshoot: "danger",
};

/** Unknown catalog entries fall back to the raw key, never to an invented name. */
export function chemicalLabel(key: string, labels: Record<string, string>): string {
  return labels[key] ?? key.replace(/_/g, " ");
}

export function apparatusLabel(key: string, labels: Record<string, string>): string {
  return labels[key] ?? key.replace(/_/g, " ");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function flaskView(stage: StageSession): FlaskView {
  const colour = stage.flaskColour;
  const hasContents = colour !== null || stage.indicatorDrops !== null;
  if (colour === null) {
    return {
      colour: null,
      label: hasContents ? "No colour recorded" : "Empty flask",
      description: hasContents
        ? "The flask has not been observed since the last change."
        : "Prepare the analyte before titrating.",
      tone: "neutral",
      hasContents,
    };
  }
  return {
    colour,
    label: FLASK_COLOUR_LABELS[colour],
    description: FLASK_COLOUR_DESCRIPTIONS[colour],
    tone: colour === "colourless" ? "neutral" : colour === "faint_pink" ? "success" : "warning",
    hasContents,
  };
}

function buretteView(stage: StageSession, stageConfig: PublicStageView): BuretteView {
  const { capacityMl, graduationMl, readingPrecisionMl } = stageConfig.burette;
  const initial = stage.buretteInitialMl;
  const reading = initial === null ? null : round2(Math.min(capacityMl, initial + stage.deliveredSoFarMl));
  return {
    capacityMl,
    graduationMl,
    readingPrecisionMl,
    readingMl: reading,
    fillFraction: reading === null ? 0 : Math.max(0, Math.min(1, 1 - reading / capacityMl)),
    setup: stage.apparatusReady,
  };
}

function trialRow(trial: StageSession["trials"][number], isOpen: boolean): TrialRowView {
  const observation =
    trial.rejectionReason ??
    (trial.observedColour
      ? FLASK_COLOUR_LABELS[trial.observedColour]
      : trial.endpointJudgement === "undertitrated"
        ? "Stopped before the endpoint"
        : trial.deliveredMl === null
          ? "No reading recorded yet"
          : "Recorded");
  return {
    trialNumber: trial.trialNumber,
    status: trial.status,
    statusLabel: TRIAL_STATUS_LABELS[trial.status],
    statusTone: TRIAL_STATUS_TONES[trial.status],
    initialReadingMl: trial.initialReadingMl,
    finalReadingMl: trial.finalReadingMl,
    titreMl: trial.deliveredMl,
    observedColour: trial.observedColour,
    observationLabel: observation,
    reportedMolarityM: trial.reportedMolarityM,
    rejectionReason: trial.rejectionReason,
    isOpen,
  };
}

function concordanceView(concordance: StageConcordance, stage: StageSession): ConcordanceView {
  const accepted = stage.trials
    .filter((trial) => trial.status === "recorded")
    .map((trial) => trial.trialNumber);
  const status: ConcordanceView["status"] =
    concordance.recordedTrials === 0
      ? "not_started"
      : concordance.trialsStillNeeded > 0 || concordance.reportedMolaritiesM.length < concordance.requiredTrials
        ? "insufficient_evidence"
        : concordance.concordant
          ? "concordant"
          : "not_concordant";

  let summary: string;
  if (status === "not_started") {
    summary = `No trials recorded yet. The experiment asks for ${concordance.requiredTrials} concordant titres.`;
  } else if (status === "insufficient_evidence") {
    summary = `${concordance.recordedTrials} trial(s) recorded, ${concordance.trialsStillNeeded} still to run, before concordance can be judged.`;
  } else if (status === "concordant") {
    summary = `Accepted titres agree within ${concordance.allowedSpread} ${concordance.spreadUnit}.`;
  } else {
    summary = `The values do not agree within ${concordance.allowedSpread} ${concordance.spreadUnit}; a further trial may be required.`;
  }

  return {
    mode: concordance.mode,
    status,
    spread: concordance.spread,
    allowedSpread: concordance.allowedSpread,
    spreadUnit: concordance.spreadUnit,
    detail: concordance.detail,
    recordedTrials: concordance.recordedTrials,
    requiredTrials: concordance.requiredTrials,
    maxTrials: concordance.maxTrials,
    trialsStillNeeded: concordance.trialsStillNeeded,
    averageMolarityM: concordance.averageMolarityM,
    discardedTrials: concordance.discardedTrials,
    acceptedTrialNumbers: accepted,
    reportedMolarityM: concordance.reportedMolaritiesM,
    summary,
  };
}

function preparationSteps(
  stage: StageSession,
  stageConfig: PublicStageView,
  labels: { chemicals: Record<string, string>; apparatus: Record<string, string> },
  requiredTrials: number,
): PreparationStepView[] {
  const prep = stage.preparation;
  const steps: PreparationStepView[] = [
    {
      key: "clean_burette",
      label: "Clean the burette",
      detail: "Rinse with several portions of tap water, then drain.",
      requires: [
        apparatusLabel("burette_50", labels.apparatus),
        chemicalLabel("tap_water", labels.chemicals),
      ],
      done: prep.buretteCleaned,
      current: false,
    },
    {
      key: "obtain_naoh_portion",
      label: "Obtain the NaOH solution in a beaker",
      detail:
        "Draw about 120 mL of the prepared solution into a clean, dry 250 mL beaker and cover it with a watch glass. The burette is conditioned and filled from it.",
      requires: [
        apparatusLabel("beaker_250", labels.apparatus),
        apparatusLabel("watch_glass", labels.apparatus),
        chemicalLabel(stageConfig.titrantKey, labels.chemicals),
      ],
      done: prep.beakerObtained,
      current: false,
    },
    {
      key: "condition_burette",
      label: "Condition the burette with NaOH",
      detail: `Rinse with three ~5 mL portions of the NaOH solution (${prep.conditioningRinses} of 3 done).`,
      requires: [chemicalLabel(stageConfig.titrantKey, labels.chemicals)],
      done: prep.conditioningRinses >= 3,
      current: false,
    },
    {
      key: "setup_apparatus",
      label: "Fill the burette and clamp it",
      detail: "Fill with the titrant to slightly above the zero mark, expel air later, then record the initial reading.",
      requires: [
        apparatusLabel(`burette_${Math.round(stageConfig.burette.capacityMl)}`, labels.apparatus),
        chemicalLabel(stageConfig.titrantKey, labels.chemicals),
      ],
      done: stage.apparatusReady && stage.buretteInitialMl !== null,
      current: false,
    },
  ];

  steps.push({
    key: "clear_air_bubble",
    label: "Clear the air bubble from the tip",
    detail: "Drain a little NaOH through the tip into a small beaker until no air remains.",
    requires: [apparatusLabel("beaker_250", labels.apparatus)],
    done: prep.airBubbleCleared,
    current: false,
  });

  if (stageConfig.analytePortion.kind === "weighed_mass") {
    steps.push({
      key: "weigh_beaker",
      label: "Weigh the KHP by difference",
      detail: `Weigh the empty beaker, add about ${stageConfig.analytePortion.nominalMassG} g KHP and weigh again, all to ±${stageConfig.analytePortion.balancePrecisionG} g.`,
      requires: [
        "analytical_balance",
        "weighing_bottle",
        chemicalLabel(stageConfig.analyteKey, labels.chemicals),
      ],
      done: stage.analyteMassG !== null,
      current: false,
    });
  } else {
    // Which ware delivers the aliquot is the procedure's business, so the copy
    // follows the configuration rather than assuming a pipette.
    const vessel = ALIQUOT_VESSEL_COPY[stageConfig.analytePortion.vessel];
    steps.push({
      key: "measure_analyte",
      label: vessel.stepLabel,
      detail: `${stageConfig.analytePortion.nominalVolumeMl} mL of ${chemicalLabel(stageConfig.analyteKey, labels.chemicals)}. ${vessel.detail}`,
      requires: [
        apparatusLabel(stageConfig.analytePortion.vessel, labels.apparatus),
        apparatusLabel("conical_flask_250", labels.apparatus),
        chemicalLabel(stageConfig.analyteKey, labels.chemicals),
      ],
      done: stage.analyteVolumeMl !== null,
      current: false,
    });
  }

  if (stageConfig.analytePortion.kind === "weighed_mass") {
    steps.push(
      {
        key: "dissolve_khp",
        label: "Dissolve the KHP",
        detail: "Add about 30 mL distilled water to the beaker and stir until clear.",
        requires: [chemicalLabel("distilled_water", labels.chemicals)],
        done: prep.khpDissolved,
        current: false,
      },
      {
        key: "transfer_solution",
        label: "Transfer to the Erlenmeyer flask",
        detail: "Pour the KHP solution into a clean 250 mL Erlenmeyer flask.",
        requires: [apparatusLabel("conical_flask_250", labels.apparatus)],
        done: prep.khpTransferred,
        current: false,
      },
      {
        key: "rinse_beaker",
        label: "Rinse the beaker twice",
        detail: `Rinse with ~5 mL distilled water into the flask each time (${prep.beakerRinses} of 2 done).`,
        requires: [chemicalLabel("distilled_water", labels.chemicals)],
        done: prep.beakerRinses >= 2,
        current: false,
      },
    );
  }

  steps.push(
    {
      key: "add_indicator",
      label: "Add the indicator",
      detail: `Add ${stageConfig.indicator.drops[0]} to ${stageConfig.indicator.drops[1]} drops of ${stageConfig.indicator.name}.`,
      requires: [chemicalLabel(stageConfig.indicator.key, labels.chemicals)],
      done: stage.indicatorDrops !== null,
      current: false,
    },
    {
      key: "place_flask",
      label: "Place the flask under the burette",
      detail: "Set the flask on the white tile, aligned under the burette tip.",
      requires: [apparatusLabel("conical_flask_250", labels.apparatus)],
      done: prep.flaskPlaced,
      current: false,
    },
    {
      key: "titrate",
      label: "Titrate to the endpoint",
      detail:
        "Swirl continuously, run the titrant in quickly at first, then dropwise as the colour begins to change.",
      requires: [apparatusLabel("conical_flask_250", labels.apparatus)],
      done: stage.trials.length > 0,
      current: false,
    },
    {
      key: "concordance",
      label: "Repeat until the titres are concordant",
      detail: `${stage.trials.length} of at least ${requiredTrials} trials recorded.`,
      requires: [],
      done: stage.trials.length >= requiredTrials,
      current: false,
    },
  );

  // Mark the first unfinished step as the current one, so the panel always
  // shows exactly where the student is without them having to reason about it.
  markFirstUnfinished(steps);
  return steps;
}

function markFirstUnfinished(steps: PreparationStepView[]): void {
  const firstUnfinished = steps.find((step) => !step.done);
  if (firstUnfinished) firstUnfinished.current = true;
}

/**
 * Part I: the working titrant prepared from stock. Purely a projection of the
 * persisted working-solution state and the public configuration — the numbers it
 * shows in its copy (2 M stock, ~0.2 M working) are the procedure's own.
 */
function solutionView(
  config: PublicTitrationConfigView,
  solution: WorkingSolutionPreparation,
  labels: { chemicals: Record<string, string>; apparatus: Record<string, string> },
): SolutionView {
  const dilution = config.solutionDilution;
  if (!dilution) {
    return {
      required: false,
      stockKey: null,
      stockMolarityM: null,
      nominalWorkingMolarityM: null,
      stockVolumeMl: null,
      diluted: false,
      mixed: false,
      ready: false,
      steps: [],
      blockers: [],
      nextAction: null,
    };
  }

  const blockers = solutionPreparationBlockers(config, solution);
  const stockLabel = chemicalLabel(dilution.stockKey, labels.chemicals);
  const steps: PreparationStepView[] = [
    {
      key: "measure_stock",
      label: `Measure the ${dilution.stockMolarityM} M stock solution`,
      detail: `Using the measuring cylinder, measure the ${stockLabel} and record the volume you measured.`,
      requires: [
        apparatusLabel("graduated_cylinder", labels.apparatus),
        stockLabel,
      ],
      done: solution.stockVolumeMl !== null,
      current: false,
    },
    {
      key: "dilute_solution",
      label: "Dilute to the working strength",
      detail: `Transfer the measured stock to a clean flask and add distilled water to make approximately ${dilution.nominalWorkingMolarityM} M.`,
      requires: [chemicalLabel("distilled_water", labels.chemicals)],
      done: solution.diluted,
      current: false,
    },
    {
      key: "mix_solution",
      label: "Stopper and swirl to mix",
      detail: "Stopper the flask as far as possible and swirl to mix the contents thoroughly.",
      requires: [],
      done: solution.mixed,
      current: false,
    },
  ];
  markFirstUnfinished(steps);

  const nextAction: NextAction | null =
    solution.stockVolumeMl === null
      ? {
          kind: "measure_stock",
          title: `Measure the ${dilution.stockMolarityM} M stock`,
          description: `Measure the ${stockLabel} in the cylinder for dilution to about ${dilution.nominalWorkingMolarityM} M, then record the volume.`,
        }
      : !solution.diluted
        ? {
            kind: "dilute_solution",
            title: "Dilute the working solution",
            description: `Transfer the measured stock to a clean flask and add distilled water to make approximately ${dilution.nominalWorkingMolarityM} M.`,
          }
        : !solution.mixed
          ? {
              kind: "mix_solution",
              title: "Stopper and swirl to mix",
              description: "Stopper the flask as far as possible and swirl to mix the contents thoroughly.",
            }
          : null;

  return {
    required: true,
    stockKey: dilution.stockKey,
    stockMolarityM: dilution.stockMolarityM,
    nominalWorkingMolarityM: dilution.nominalWorkingMolarityM,
    stockVolumeMl: solution.stockVolumeMl,
    diluted: solution.diluted,
    mixed: solution.mixed,
    ready: blockers.length === 0,
    steps,
    blockers,
    nextAction,
  };
}

function nextActionFor(
  stage: StageSession,
  stageConfig: PublicStageView,
  canWrite: boolean,
  trials: { nextTrialNumber: number | null; requiredTrials: number; maxTrials: number },
): NextAction | null {
  if (!canWrite) {
    return {
      kind: "read_only",
      title: "This attempt is closed",
      description: "Readings are frozen, so no further actions are available.",
    };
  }
  const prep = stage.preparation;
  if (!prep.buretteCleaned) {
    return {
      kind: "rinse_burette",
      title: "Clean the burette",
      description: "Rinse the burette with several portions of tap water and drain it.",
    };
  }
  if (!prep.beakerObtained) {
    return {
      kind: "obtain_naoh_portion",
      title: "Obtain the NaOH solution in a beaker",
      description:
        "Draw about 120 mL of the prepared solution into a clean, dry 250 mL beaker and cover it with a watch glass.",
    };
  }
  if (prep.conditioningRinses < 3) {
    return {
      kind: "condition_burette",
      title: `Condition the burette (${prep.conditioningRinses} of 3 rinses done)`,
      description: "Rinse with a ~5 mL portion of the NaOH solution and drain, three times.",
    };
  }
  if (!stage.apparatusReady || stage.buretteInitialMl === null) {
    return {
      kind: "setup_apparatus",
      title: "Set up the burette",
      description: `Select the ${stageConfig.titrantKey} bottle on the bench, fill the burette and record the initial reading.`,
    };
  }
  if (!prep.airBubbleCleared) {
    return {
      kind: "clear_air_bubble",
      title: "Clear the air bubble from the tip",
      description: "Drain a little NaOH through the tip into a small beaker until no air remains.",
    };
  }
  if (stageConfig.analytePortion.kind === "weighed_mass" && stage.analyteMassG === null) {
    return {
      kind: "weigh_beaker",
      title:
        prep.beakerMassG === null ? "Weigh the empty beaker" : "Weigh the beaker plus KHP",
      description:
        "Weigh on the analytical balance to two decimal places; the sample mass comes from the difference.",
    };
  }
  if (stageConfig.analytePortion.kind === "pipetted_volume" && stage.analyteVolumeMl === null) {
    const vessel = ALIQUOT_VESSEL_COPY[stageConfig.analytePortion.vessel];
    return {
      kind: "pipette_analyte",
      title: vessel.nextTitle,
      description: vessel.nextDescription,
    };
  }
  if (stageConfig.analytePortion.kind === "weighed_mass" && !prep.khpDissolved) {
    return {
      kind: "dissolve_khp",
      title: "Dissolve the KHP",
      description: "Add about 30 mL distilled water to the beaker and stir until the solution is clear.",
    };
  }
  if (stageConfig.analytePortion.kind === "weighed_mass" && !prep.khpTransferred) {
    return {
      kind: "transfer_solution",
      title: "Transfer to the Erlenmeyer flask",
      description: "Pour the KHP solution into a clean 250 mL Erlenmeyer flask.",
    };
  }
  if (stageConfig.analytePortion.kind === "weighed_mass" && prep.beakerRinses < 2) {
    return {
      kind: "rinse_beaker",
      title: `Rinse the beaker (${prep.beakerRinses} of 2 rinses done)`,
      description: "Rinse with ~5 mL distilled water into the flask so all of the acid is transferred.",
    };
  }
  if (stage.indicatorDrops === null) {
    return {
      kind: "add_indicator",
      title: "Add the indicator",
      description: `Add ${stageConfig.indicator.drops[0]}–${stageConfig.indicator.drops[1]} drops of ${stageConfig.indicator.name}.`,
    };
  }
  if (!prep.flaskPlaced) {
    return {
      kind: "place_flask",
      title: "Place the flask under the burette",
      description: "Set the flask on the white tile, aligned under the burette tip.",
    };
  }
  if (stage.openTrial) {
    if (stage.openTrial.finalReadingMl === null || stage.openTrial.deliveredMl === null) {
      if (stage.deliveredSoFarMl <= 0) {
        return {
          kind: "add_titrant",
          title: "Run in the titrant",
          description: "Open the stopcock and deliver titrant, swirling the flask as you go.",
        };
      }
      return {
        kind: "read_burette",
        title: "Record the final burette reading",
        description: "Read the bottom of the meniscus and record it to two decimal places.",
      };
    }
    return {
      kind: "complete_trial",
      title: "Complete the trial",
      description: "Close the trial so the titre is judged against the endpoint.",
    };
  }

  // A recorded trial whose concentration has not been reported yet is the next
  // thing to submit; the student may still choose to run another trial first.
  const unreported = stage.trials
    .filter((trial) => trial.status === "recorded" && trial.reportedMolarityM === null)
    .map((trial) => trial.trialNumber)
    .sort((a, b) => a - b);
  if (unreported.length > 0) {
    return {
      kind: "report_molarity",
      title: `Report the concentration for trial ${unreported[0]}`,
      description: "Work the calculation out and submit it in the calculations panel.",
    };
  }

  // A completed trial whose solution is still in the flask must be discarded
  // into waste before the next trial may start.
  if (stage.trials.length > 0 && !stage.preparation.lastTrialDiscarded) {
    return {
      kind: "discard_to_waste",
      title: "Discard the trial solution",
      description: "Pour the flask contents into the waste container so the next trial starts clean.",
    };
  }

  const recordedTrials = stage.trials.filter((trial) => trial.status === "recorded").length;
  if (recordedTrials >= trials.maxTrials) {
    return {
      kind: "stage_complete",
      title: "No further trials are allowed",
      description: `The experiment permits at most ${trials.maxTrials} trials for this stage.`,
    };
  }
  if (recordedTrials >= trials.requiredTrials) {
    return {
      kind: "stage_complete",
      title: "Enough trials recorded",
      description: `${trials.requiredTrials} trials are recorded; check the concordance panel before deciding whether another is needed.`,
    };
  }
  if (trials.nextTrialNumber === null) {
    return {
      kind: "stage_complete",
      title: "No further trials are allowed",
      description: `The experiment permits at most ${trials.maxTrials} trials for this stage.`,
    };
  }
  return {
    kind: "start_trial",
    title: `Start trial ${trials.nextTrialNumber}`,
    description: "Confirm the initial burette reading and begin the next titration.",
  };
}

export function buildLabViewModel(input: LabViewModelInput): LabViewModel {
  const { config, publicState, canWrite } = input;
  const labels = { chemicals: input.chemicalLabels, apparatus: input.apparatusLabels };
  const solution = solutionView(
    config,
    publicState.solution ?? emptyWorkingSolution(),
    labels,
  );

  const configuredStages = config.stages.map((stageConfig, index) => {
    const stage = publicState.stages[stageConfig.key];
    const previousTrials = stage?.trials ?? [];
    // Two separate budgets, exactly as the engine applies them: the manual's
    // RECORDED trials (a discarded overshoot is repeated, not counted) and the
    // attempt cap that bounds how many runs a stage may total.
    const countedTrials = previousTrials.filter(
      (trial) => trial.status === "recorded" || trial.status === "open",
    ).length;
    const nextTrialNumber =
      countedTrials >= config.trialRules.maxTrials ||
      previousTrials.length >= config.trialRules.maxTrialAttempts
        ? null
        : Math.max(0, ...previousTrials.map((trial) => trial.trialNumber)) + 1;

    const trials = previousTrials.map((trial) => trialRow(trial, false));

    return {
      stageConfig,
      index,
      stage,
      trials,
      nextTrialNumber,
    };
  });

  const derivedActiveKey =
    configuredStages.find(
      (entry) =>
        entry.stage === undefined ||
        entry.stage.concordance.recordedTrials < entry.stage.concordance.requiredTrials,
    )?.stageConfig.key ??
    configuredStages[configuredStages.length - 1]?.stageConfig.key ??
    "";

  const activeStageKey =
    input.selectedStageKey && publicState.stages[input.selectedStageKey]
      ? input.selectedStageKey
      : derivedActiveKey;

  const stages: StageView[] = configuredStages.map((entry) => {    const { stageConfig, index, stage, trials, nextTrialNumber } = entry;
    // A stage is always present in the resumed session; the fallback keeps the
    // view model total even if a snapshot were missing one.
    const session: StageSession = stage ?? {
      phase: "setup",
      apparatusReady: false,
      indicatorDrops: null,
      analyteMassG: null,
      analyteVolumeMl: null,
      buretteInitialMl: null,
      deliveredSoFarMl: 0,
      flaskColour: null,
      trials: [],
      reportedMolaritiesM: [],
      openTrial: null,
      preparation: emptyPreparation(),
    };
    const stageNextAction = nextActionFor(session, stageConfig, canWrite, {
      nextTrialNumber,
      requiredTrials: config.trialRules.minTrials,
      maxTrials: config.trialRules.maxTrials,
    });
    // Part I unblocks every stage, so while the working solution is still being
    // prepared THAT is the student's next step — not the burette work it feeds.
    const nextAction =
      solution.nextAction !== null && stageConfig.key === activeStageKey
        ? solution.nextAction
        : stageNextAction;
    const openTrial = session.openTrial ? trialRow(session.openTrial, true) : null;
    const concordance = concordanceView(
      stage?.concordance ?? {
        mode: config.trialRules.concordance.mode,
        requiredTrials: config.trialRules.minTrials,
        maxTrials: config.trialRules.maxTrials,
        recordedTrials: 0,
        discardedTrials: [],
        reportedMolaritiesM: [],
        spread: null,
        allowedSpread:
          config.trialRules.concordance.mode === "molarity"
            ? config.trialRules.concordance.maxSpreadM
            : config.trialRules.concordance.toleranceMl,
        spreadUnit: config.trialRules.concordance.mode === "molarity" ? "mol/L" : "mL",
        concordant: false,
        averageMolarityM: null,
        trialsStillNeeded: config.trialRules.minTrials,
        detail: "need at least two trials",
      },
      session,
    );

    return {
      key: stageConfig.key,
      index,
      title: stageConfig.title,
      reactionEquation: stageConfig.reactionEquation,
      titrantKey: stageConfig.titrantKey,
      analyteKey: stageConfig.analyteKey,
      isActive: stageConfig.key === activeStageKey,
      complete: concordance.status === "concordant",
      // Locks and the experiment-complete override are applied in a second
      // pass below, once every stage's completion is known.
      locked: false,
      lockedBy: null,
      phase: session.phase,
      preparation: preparationSteps(session, stageConfig, labels, config.trialRules.minTrials),
      nextAction,
      flask: flaskView(session),
      burette: buretteView(session, stageConfig),
      indicator: {
        key: stageConfig.indicator.key,
        name: stageConfig.indicator.name,
        dropsRange: [stageConfig.indicator.drops[0], stageConfig.indicator.drops[1]],
        dropsAdded: session.indicatorDrops,
        persistenceSeconds: [
          stageConfig.indicator.endpointPersistenceSeconds[0],
          stageConfig.indicator.endpointPersistenceSeconds[1],
        ],
      },
      portion:
        stageConfig.analytePortion.kind === "weighed_mass"
          ? {
              kind: "weighed_mass" as const,
              recordedMassG: session.analyteMassG,
              nominalMassG: stageConfig.analytePortion.nominalMassG,
              precision: stageConfig.analytePortion.balancePrecisionG,
            }
          : {
              kind: "pipetted_volume" as const,
              recordedVolumeMl: session.analyteVolumeMl,
              nominalVolumeMl: stageConfig.analytePortion.nominalVolumeMl,
              precision: stageConfig.analytePortion.volumePrecisionMl,
              vessel: stageConfig.analytePortion.vessel,
            },
      openTrial,
      trials,
      nextTrialNumber,
      deliveredMl: session.deliveredSoFarMl,
      concordance,
      preparationState: session.preparation,
      trialBlockers: preparationBlockersForTrial(
        config,
        stageConfig.key,
        session,
        publicState.solution ?? emptyWorkingSolution(),
      ),
      hasCompletedTrial: session.trials.length > 0,
    };
  });

  // A later stage locks behind the first incomplete earlier stage, mirroring
  // the server-side `stage_locked` rule so the bench shows the lock up front
  // instead of letting the student discover it through a rejection.
  const firstIncompleteIndex = stages.findIndex((stage) => !stage.complete);
  const unlockedStages = stages.map((stage, index) => {
    const blocker =
      firstIncompleteIndex === -1 || index <= firstIncompleteIndex
        ? null
        : stages[firstIncompleteIndex];
    return { ...stage, locked: blocker !== null, lockedBy: blocker?.title ?? null };
  });

  // Every stage concordant: the bench work is done, and the next step is the
  // review and submission panel rather than another titration.
  const experimentComplete =
    canWrite && unlockedStages.length > 0 && unlockedStages.every((stage) => stage.complete);
  const finalStages = experimentComplete
    ? unlockedStages.map((stage) =>
        stage.isActive
          ? {
              ...stage,
              nextAction: {
                kind: "review_submit" as const,
                title: "Review and submit",
                description:
                  "Every stage is concordant. Check the results, finish the report and submit the attempt.",
              },
            }
          : stage,
      )
    : unlockedStages;

  const recordedTrials = finalStages.reduce((total, stage) => total + stage.concordance.recordedTrials, 0);
  const requiredTrials = finalStages.reduce((total, stage) => total + stage.concordance.requiredTrials, 0);

  return {
    activeStageKey,
    solution,
    stages: finalStages,
    progress: {
      recordedTrials,
      requiredTrials,
      percent: requiredTrials === 0 ? 0 : Math.round((recordedTrials / requiredTrials) * 100),
      label: `${recordedTrials} of ${requiredTrials} required trials recorded`,
    },
    notices: [],
  };
}

/**
 * How much endpoint pink is visible in the flask, as an overlay opacity.
 *
 * The bench draws a colourless solution and layers the endpoint colour on top,
 * which keeps the visual honest across the four observed states without relying
 * on colour-mix support inside SVG. Colour is never the only signal: every
 * caller also renders the textual label from `flask.label`.
 */
export function flaskPinkOpacity(colour: FlaskColour | null): number {
  switch (colour) {
    case "faint_pink":
      return 0.3;
    case "pink":
      return 0.6;
    case "deep_pink":
      return 0.95;
    default:
      return 0;
  }
}
