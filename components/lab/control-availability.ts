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
import type { StageView } from "./view-model";

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
    stage.burette.setup ? AVAILABLE : unavailable(CONTROL_REASONS.analyteNeedsBurette),
  );
}

/** Add the indicator. The engine accepts it only in the `analyte_ready` phase. */
export function indicatorAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
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
    stage.openTrial ? AVAILABLE : unavailable(CONTROL_REASONS.readingNeedsTrial),
  );
}

/** Close the trial. The engine requires the final reading first. */
export function completionAvailability(
  stage: StageView,
  flags: LabControlFlags,
): ControlAvailability {
  return gate(flags, () => {
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
    stage.openTrial ? AVAILABLE : unavailable(CONTROL_REASONS.observationNeedsTrial),
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
    stage.openTrial ? AVAILABLE : unavailable(CONTROL_REASONS.swirlNeedsTrial),
  );
}

/** Enlarge the burette to read the meniscus. A read aid, so only the gate applies. */
export function focusModeAvailability(flags: LabControlFlags): ControlAvailability {
  return gate(flags, () => AVAILABLE);
}
