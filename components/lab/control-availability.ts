/**
 * Why a control cannot be used yet.
 *
 * A greyed-out button teaches nothing, and a tooltip teaches nothing on a
 * touchscreen. Every gate in the laboratory therefore resolves to a REASON, and
 * the reason is rendered as visible text tied to its control with
 * `aria-describedby`.
 *
 * Each reason describes a rule the DOMAIN already enforces — no control invents
 * a requirement of its own. `tests/application/control-availability.test.ts`
 * holds the two together by feeding the matching state to the real engine and
 * asserting it refuses, so a hint can never outlive the rule it describes.
 *
 * Pure: no React, no DOM, no chemistry. It reads the view model and the UI
 * flags, and returns strings.
 */
import type { SolutionView, StageView } from "./view-model";

export interface ControlAvailability {
  available: boolean;
  /** Null exactly when `available` is true. Always the text shown. */
  reason: string | null;
}

export interface LabControlFlags {
  /** False on a submitted/closed attempt: the bench is read-only. */
  canWrite: boolean;
  /** True while an action is in flight; only one may be in flight at a time. */
  pending: boolean;
  /**
   * Whether the stopcock is currently turned for the active stage. Only the
   * delivery rule reads it; controls that never deliver titrant may omit it.
   */
  stopcockOpen?: boolean;
}

/** Every student-facing reason this module can produce, by stable key. */
export const CONTROL_REASONS = {
  closed: "This attempt has been submitted, so the bench is read-only.",
  saving: "Another action is still being saved. Wait for the laboratory to confirm it.",
  stageLocked: "Complete the earlier stage first — stages unlock in order.",

  analyteNeedsBurette: "Set up the burette before measuring the sample.",
  indicatorNeedsAnalyte: "Prepare the sample in the flask before adding the indicator.",
  indicatorAlreadyAdded: "The indicator has already been added. Start a trial.",

  startNeedsPreparation: "Prepare the sample and add the indicator before starting a trial.",
  trialAlreadyOpen: "A trial is already running. Complete it before starting another.",
  noTrialsLeft: "This stage allows no further trials.",

  stopcockNeedsBurette: "Fill the burette before opening the stopcock.",
  stopcockNeedsTrial: "Add the indicator and start a trial before opening the stopcock.",
  deliveryNeedsTrial: "Start a trial before delivering titrant.",
  deliveryNeedsStopcock: "Open the stopcock before delivering titrant.",

  readingNeedsTrial: "No trial is running, so there is no burette reading to record.",
  completionNeedsReading: "Record the final burette reading before completing the trial.",
  observationNeedsTrial: "There is no trial in progress to observe.",
  swirlNeedsTrial: "There is nothing in the flask to swirl yet.",

  stockAlreadyMeasured: "The stock solution has already been measured.",
  dilutionNeedsStock: "Measure the stock solution before diluting it.",
  solutionAlreadyDiluted: "Distilled water has already been added to the dilution.",
  mixNeedsDilution: "Add the distilled water before mixing the solution.",
  solutionAlreadyMixed: "The working solution is already mixed.",
  portionNeedsSolution: "Prepare the working solution from the stock before taking a portion of it.",
  portionAlreadyObtained: "The beaker already holds a portion of the working solution.",
  conditionNeedsPortion: "Obtain a portion of the working solution in a beaker before conditioning the burette.",

  buretteAlreadyClean: "The burette has already been rinsed with tap water.",
  conditionNeedsClean: "Rinse the burette with tap water before conditioning it.",
  buretteAlreadyConditioned: "The burette has had its three NaOH conditioning rinses.",
  bubbleNeedsBurette: "Fill the burette before clearing air from its tip.",
  bubbleAlreadyCleared: "Air has already been expelled from the burette tip.",
  beakerWeighNeedsBurette: "Set up the burette before weighing.",
  beakerWeighingsDone: "Both beaker weighings are already recorded for this stage.",
  dissolveNeedsSample: "Weigh the KHP sample before dissolving it.",
  khpAlreadyDissolved: "The KHP is already dissolved.",
  transferNeedsDissolved: "Dissolve the KHP before transferring it.",
  solutionAlreadyTransferred: "The solution is already in the flask.",
  beakerRinseNeedsTransfer: "Transfer the solution before rinsing the beaker.",
  beakerAlreadyRinsed: "The beaker has had both rinses into the flask.",
  placeNeedsBurette: "Fill the burette before placing the flask under it.",
  flaskAlreadyPlaced: "The flask is already under the burette.",
  discardNothingToDiscard: "There is no completed trial to discard yet.",
  discardAlreadyDone: "The completed trial has already been discarded.",
} as const;

export type ControlReasonKey = keyof typeof CONTROL_REASONS;

const AVAILABLE: ControlAvailability = { available: true, reason: null };

function unavailable(reason: string): ControlAvailability {
  return { available: false, reason };
}

/**
 * The two gates that apply to every control: a closed attempt, and an action
 * already in flight.
 */
function blockingGate(flags: LabControlFlags): ControlAvailability | null {
  if (!flags.canWrite) return unavailable(CONTROL_REASONS.closed);
  if (flags.pending) return unavailable(CONTROL_REASONS.saving);
  return null;
}

function gate(flags: LabControlFlags, rule: () => ControlAvailability): ControlAvailability {
  return blockingGate(flags) ?? rule();
}

/**
 * The stage-order gate: a locked stage mirrors the server-side `stage_locked`
 * rule, so every control on it explains the lock with the same reason instead
 * of sending an action the server must refuse.
 */
function stageLock(stage: StageView): ControlAvailability | null {
  if (!stage.locked) return null;
  return unavailable(CONTROL_REASONS.stageLocked);
}

/** Selecting a reagent or apparatus is a UI aid; it only needs a writable bench. */
export function selectionAvailability(flags: LabControlFlags): ControlAvailability {
  return gate(flags, () => AVAILABLE);
}

/** Rinse, fill and clamp the burette (the engine's `setup_apparatus`). */
export function buretteSetupAvailability(flags: LabControlFlags): ControlAvailability {
  return gate(flags, () => AVAILABLE);
}

/**
 * Weigh the sample, or pipette the aliquot. The engine refuses both until the
 * burette is ready, so the reason cannot be invented here.
 */
export function analytePortionAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () =>
    stageLock(stage) ?? (stage.burette.setup ? AVAILABLE : unavailable(CONTROL_REASONS.analyteNeedsBurette)),
  );
}

/** Add the indicator. The engine accepts it only in the `analyte_ready` phase. */
export function indicatorAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (stage.phase === "analyte_ready") return AVAILABLE;
    return unavailable(
      stage.phase === "indicator_added"
        ? CONTROL_REASONS.indicatorAlreadyAdded
        : CONTROL_REASONS.indicatorNeedsAnalyte,
    );
  });
}

/** Begin the next titration. */
export function startTrialAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (stage.openTrial) return unavailable(CONTROL_REASONS.trialAlreadyOpen);
    if (stage.nextTrialNumber === null) return unavailable(CONTROL_REASONS.noTrialsLeft);
    if (stage.phase !== "indicator_added" && stage.phase !== "titrating") {
      return unavailable(CONTROL_REASONS.startNeedsPreparation);
    }
    return AVAILABLE;
  });
}

/** Turn the stopcock. Meaningless before a trial is running. */
export function stopcockAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.burette.setup) return unavailable(CONTROL_REASONS.stopcockNeedsBurette);
    if (!stage.openTrial) return unavailable(CONTROL_REASONS.stopcockNeedsTrial);
    return AVAILABLE;
  });
}

/** Deliver titrant. Needs a running trial AND an open stopcock. */
export function deliveryAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.openTrial) return unavailable(CONTROL_REASONS.deliveryNeedsTrial);
    if (!flags.stopcockOpen) return unavailable(CONTROL_REASONS.deliveryNeedsStopcock);
    return AVAILABLE;
  });
}

/** Record the final burette reading for the open trial. */
export function readingAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () =>
    stageLock(stage) ?? (stage.openTrial ? AVAILABLE : unavailable(CONTROL_REASONS.readingNeedsTrial)),
  );
}

/** Close the trial. The engine requires the final reading first. */
export function completionAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.openTrial) return unavailable(CONTROL_REASONS.readingNeedsTrial);
    if (stage.openTrial.finalReadingMl === null) {
      return unavailable(CONTROL_REASONS.completionNeedsReading);
    }
    return AVAILABLE;
  });
}

/** Record the colour seen at the endpoint: the engine needs an open trial. */
export function observationAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () =>
    stageLock(stage) ?? (stage.openTrial ? AVAILABLE : unavailable(CONTROL_REASONS.observationNeedsTrial)),
  );
}

/**
 * Swirl the flask. Purely visual — it records nothing — but it is still part of
 * the bench, so it is explained rather than silently inert.
 */
export function swirlAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () =>
    stageLock(stage) ?? (stage.openTrial ? AVAILABLE : unavailable(CONTROL_REASONS.swirlNeedsTrial)),
  );
}

/** Enlarge the burette to read the meniscus. A read aid, so only the gate applies. */
export function focusModeAvailability(flags: LabControlFlags): ControlAvailability {
  return gate(flags, () => AVAILABLE);
}

// ---------------------------------------------------------------------------
// Part I: the working titrant prepared from stock. Session-level, so these read
// the solution view rather than a stage.
// ---------------------------------------------------------------------------

/** Measure the stock solution the working titrant is diluted from. */
export function stockMeasureAvailability(
  solution: SolutionView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () =>
    solution.stockVolumeMl === null ? AVAILABLE : unavailable(CONTROL_REASONS.stockAlreadyMeasured),
  );
}

/** Add distilled water to complete the dilution. */
export function dilutionAvailability(
  solution: SolutionView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    if (solution.stockVolumeMl === null) return unavailable(CONTROL_REASONS.dilutionNeedsStock);
    if (solution.diluted) return unavailable(CONTROL_REASONS.solutionAlreadyDiluted);
    return AVAILABLE;
  });
}

/** Stopper as far as possible and swirl to mix the dilution. */
export function mixSolutionAvailability(
  solution: SolutionView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    if (!solution.diluted) return unavailable(CONTROL_REASONS.mixNeedsDilution);
    if (solution.mixed) return unavailable(CONTROL_REASONS.solutionAlreadyMixed);
    return AVAILABLE;
  });
}

/** Draw a portion of the prepared solution into the beaker. */
export function naohPortionAvailability(
  stage: StageView,
  solution: SolutionView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!solution.required || !solution.ready) {
      return unavailable(CONTROL_REASONS.portionNeedsSolution);
    }
    if (stage.preparationState.beakerObtained) {
      return unavailable(CONTROL_REASONS.portionAlreadyObtained);
    }
    return AVAILABLE;
  });
}

// ---------------------------------------------------------------------------
// Procedure preparation (Experiment 2, Part 2). Each reason mirrors a rule the
// engine or the trial gate already enforces — see the coupling tests in
// `tests/application/preparation-availability.test.ts`, which feed the matching
// state to the real engine and assert it refuses.
// ---------------------------------------------------------------------------

/** Rinse the burette with tap water (manual cleaning step). */
export function rinseBuretteAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (stage.preparationState.buretteCleaned) return unavailable(CONTROL_REASONS.buretteAlreadyClean);
    return AVAILABLE;
  });
}

/** Condition the burette with NaOH, three counted rinses. */
export function conditionBuretteAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.preparationState.buretteCleaned) return unavailable(CONTROL_REASONS.conditionNeedsClean);
    if (!stage.preparationState.beakerObtained) {
      return unavailable(CONTROL_REASONS.conditionNeedsPortion);
    }
    if (stage.preparationState.conditioningRinses >= 3) {
      return unavailable(CONTROL_REASONS.buretteAlreadyConditioned);
    }
    return AVAILABLE;
  });
}

/** Expel air from the burette tip after filling. */
export function airBubbleAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.burette.setup) return unavailable(CONTROL_REASONS.bubbleNeedsBurette);
    if (stage.preparationState.airBubbleCleared) return unavailable(CONTROL_REASONS.bubbleAlreadyCleared);
    return AVAILABLE;
  });
}

/** Weigh the empty beaker, then beaker plus KHP (weighing by difference). */
export function beakerWeighAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.burette.setup) return unavailable(CONTROL_REASONS.beakerWeighNeedsBurette);
    if (
      stage.preparationState.beakerMassG !== null &&
      stage.preparationState.beakerPlusKhpMassG !== null
    ) {
      return unavailable(CONTROL_REASONS.beakerWeighingsDone);
    }
    return AVAILABLE;
  });
}

/** Dissolve the weighed KHP in distilled water. */
export function dissolveAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (stage.portion.kind !== "weighed_mass" || stage.portion.recordedMassG === null) {
      return unavailable(CONTROL_REASONS.dissolveNeedsSample);
    }
    if (stage.preparationState.khpDissolved) return unavailable(CONTROL_REASONS.khpAlreadyDissolved);
    return AVAILABLE;
  });
}

/** Transfer the KHP solution to the Erlenmeyer flask. */
export function transferAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.preparationState.khpDissolved) {
      return unavailable(CONTROL_REASONS.transferNeedsDissolved);
    }
    if (stage.preparationState.khpTransferred) {
      return unavailable(CONTROL_REASONS.solutionAlreadyTransferred);
    }
    return AVAILABLE;
  });
}

/** Rinse the beaker into the flask, twice. */
export function rinseBeakerAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.preparationState.khpTransferred) {
      return unavailable(CONTROL_REASONS.beakerRinseNeedsTransfer);
    }
    if (stage.preparationState.beakerRinses >= 2) {
      return unavailable(CONTROL_REASONS.beakerAlreadyRinsed);
    }
    return AVAILABLE;
  });
}

/** Place the flask under the burette. */
export function placeFlaskAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.burette.setup) return unavailable(CONTROL_REASONS.placeNeedsBurette);
    if (stage.preparationState.flaskPlaced) return unavailable(CONTROL_REASONS.flaskAlreadyPlaced);
    return AVAILABLE;
  });
}

/** Discard a completed trial into the waste container. */
export function discardAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
    const lock = stageLock(stage);
    if (lock) return lock;
    if (!stage.hasCompletedTrial) return unavailable(CONTROL_REASONS.discardNothingToDiscard);
    if (stage.preparationState.lastTrialDiscarded) {
      return unavailable(CONTROL_REASONS.discardAlreadyDone);
    }
    return AVAILABLE;
  });
}
