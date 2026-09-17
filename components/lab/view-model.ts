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
import type {
  StageConcordance,
  StageSession,
  TitrationPublicState,
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
  };
  portion:
    | { kind: "weighed_mass"; recordedMassG: number | null; nominalMassG: number; precision: number }
    | { kind: "pipetted_volume"; recordedVolumeMl: number | null; nominalVolumeMl: number; precision: number };
  openTrial: TrialRowView | null;
  trials: TrialRowView[];
  nextTrialNumber: number | null;
  deliveredMl: number;
  concordance: ConcordanceView;
}

export interface LabViewModel {
  activeStageKey: string;
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
  const steps: PreparationStepView[] = [
    {
      key: "setup_apparatus",
      label: "Rinse, fill and clamp the burette",
      detail: "Fill with the titrant, expel air from the tip, then record the initial reading.",
      requires: [
        apparatusLabel(`burette_${Math.round(stageConfig.burette.capacityMl)}`, labels.apparatus),
        chemicalLabel(stageConfig.titrantKey, labels.chemicals),
      ],
      done: stage.apparatusReady && stage.buretteInitialMl !== null,
      current: false,
    },
  ];

  if (stageConfig.analytePortion.kind === "weighed_mass") {
    steps.push({
      key: "weigh_analyte",
      label: "Weigh the primary standard into the flask",
      detail: `Target about ${stageConfig.analytePortion.nominalMassG} g, weighed to ±${stageConfig.analytePortion.balancePrecisionG} g.`,
      requires: [
        "analytical_balance",
        "weighing_bottle",
        chemicalLabel(stageConfig.analyteKey, labels.chemicals),
      ],
      done: stage.analyteMassG !== null,
      current: false,
    });
  } else {
    steps.push({
      key: "pipette_analyte",
      label: "Pipette the aliquot into the flask",
      detail: `Rinse the pipette with the solution, then deliver ${stageConfig.analytePortion.nominalVolumeMl} mL using the pipette filler.`,
      requires: [
        "pipette",
        "pipette_filler",
        apparatusLabel("conical_flask_250", labels.apparatus),
        chemicalLabel(stageConfig.analyteKey, labels.chemicals),
      ],
      done: stage.analyteVolumeMl !== null,
      current: false,
    });
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
  const firstUnfinished = steps.find((step) => !step.done);
  if (firstUnfinished) firstUnfinished.current = true;
  return steps;
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
  if (!stage.apparatusReady || stage.buretteInitialMl === null) {
    return {
      kind: "setup_apparatus",
      title: "Set up the burette",
      description: `Select the ${stageConfig.titrantKey} bottle on the bench, fill the burette and record the initial reading.`,
    };
  }
  if (stageConfig.analytePortion.kind === "weighed_mass" && stage.analyteMassG === null) {
    return {
      kind: "weigh_analyte",
      title: "Weigh the sample",
      description:
        "Place the weighing bottle on the balance, tare if you need to, add the standard and record the mass.",
    };
  }
  if (stageConfig.analytePortion.kind === "pipetted_volume" && stage.analyteVolumeMl === null) {
    return {
      kind: "pipette_analyte",
      title: "Pipette the aliquot",
      description:
        "Fill the pipette with the filler, wipe the tip, then deliver it into the conical flask and record the volume.",
    };
  }
  if (stage.indicatorDrops === null) {
    return {
      kind: "add_indicator",
      title: "Add the indicator",
      description: `Add ${stageConfig.indicator.drops[0]}–${stageConfig.indicator.drops[1]} drops of ${stageConfig.indicator.name}.`,
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

  const configuredStages = config.stages.map((stageConfig, index) => {
    const stage = publicState.stages[stageConfig.key];
    const previousTrials = stage?.trials ?? [];
    const nextTrialNumber =
      previousTrials.length >= config.trialRules.maxTrials
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

  const stages: StageView[] = configuredStages.map((entry) => {
    const { stageConfig, index, stage, trials, nextTrialNumber } = entry;
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
    };
    const nextAction = nextActionFor(session, stageConfig, canWrite, {
      nextTrialNumber,
      requiredTrials: config.trialRules.minTrials,
      maxTrials: config.trialRules.maxTrials,
    });
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
            },
      openTrial,
      trials,
      nextTrialNumber,
      deliveredMl: session.deliveredSoFarMl,
      concordance,
    };
  });

  const recordedTrials = stages.reduce((total, stage) => total + stage.concordance.recordedTrials, 0);
  const requiredTrials = stages.reduce((total, stage) => total + stage.concordance.requiredTrials, 0);

  return {
    activeStageKey,
    stages,
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
