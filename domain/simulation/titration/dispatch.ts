/**
 * Protocol action router: one validated action in, one engine call out.
 *
 * This is the ONLY place a protocol action is mapped onto a domain function, so
 * every caller — the autosaving server action and the development-only preview
 * harness — routes actions identically and cannot drift apart. It performs no
 * persistence, reads no environment, and imports nothing server-only.
 *
 * Three checks belong here rather than in the engine, because they are properties
 * of the EXPERIMENT or the client rather than of the titration chemistry:
 *
 *  - a stale client naming a stage this attempt no longer has is rejected as a
 *    protocol problem instead of throwing out of the caller;
 *  - an observation may only name a field the experiment declares;
 *  - a stage whose predecessors are still incomplete is LOCKED: the experiment
 *    runs in order (Stage A standardisation before Stage B determination), so
 *    an action naming a locked stage is refused no matter what the client shows.
 *
 * A fourth family of checks enforces the Experiment 2 preparation procedure:
 * filling requires a cleaned and conditioned burette, and starting a trial
 * requires the full preparation chain (weighing by difference, dissolution,
 * transfer, rinses, indicator, flask placement, cleared tip) for trial 1, plus
 * waste disposal of the previous trial for later trials. These live here — not
 * in the engine functions, which keep validating only their own slot — so the
 * titration core the earlier tests describe keeps working unchanged.
 *
 * SECURITY: `expected` is deliberately dropped from a `report_molarity` result.
 * Correctness is recomputed server-side at grade time from hidden state, so the
 * answer never crosses to the browser.
 */
import { declaredObservationFieldsFor } from "@/domain/experiments/catalog/catalog-registry";
import type { TitrationProtocolAction } from "./protocol";
import {
  addIndicator,
  addTitrant,
  clearAirBubble,
  completeTrial,
  conditionBurette,
  discardToWaste,
  diluteWorkingSolution,
  dissolveKhp,
  measureStockVolume,
  mixWorkingSolution,
  obtainTitrantPortion,
  observeEndpoint,
  pipetteAnalyte,
  placeFlask,
  preparationBlockersForTrial,
  projectPublicState,
  readBurette,
  recordObservation,
  reportMolarity,
  rinseBeaker,
  rinseBurette,
  setupApparatus,
  solutionPreparationBlockers,
  startTrialAction,
  transferSolution,
  weighAnalyte,
  weighBeakerMass,
  REQUIRED_CONDITIONING_RINSES,
  type ActionResult,
  type TitrationSession,
} from "./engine";
import { projectExperimentWorkflow } from "./workflow";

/** The engine-facing half of an action's result. Nothing hidden may be added. */
export interface TitrationDispatchOutcome {
  accepted: boolean;
  code: string | null;
  message: string | null;
  /** Colour the student sees after a delivery/observation, else null. */
  colour: string | null;
  /** Whether a reported molarity matched — NEVER the expected value. */
  calculationCorrect: boolean | null;
}

function rejected(result: ActionResult): TitrationDispatchOutcome {
  return {
    accepted: false,
    code: "code" in result && typeof result.code === "string" ? result.code : "rejected",
    message:
      "error" in result && typeof result.error === "string" ? result.error : "Action rejected",
    colour: null,
    calculationCorrect: null,
  };
}

function acceptedOutcome(
  extra: Partial<TitrationDispatchOutcome> = {},
): TitrationDispatchOutcome {
  return {
    accepted: true,
    code: null,
    message: null,
    colour: null,
    calculationCorrect: null,
    ...extra,
  };
}

/** Refusal for a skipped preparation step. Never carries a hidden value. */
function preparationRefusal(message: string): TitrationDispatchOutcome {
  return {
    accepted: false,
    code: "preparation_incomplete",
    message,
    colour: null,
    calculationCorrect: null,
  };
}

/**
 * Procedure gates for filling and starting trials. Returns a refusal, or null
 * when the action may proceed to the engine.
 */
function preparationGateFor(
  session: TitrationSession,
  action: TitrationProtocolAction,
): TitrationDispatchOutcome | null {
  if (action.type === "setup_apparatus") {
    // Part I first: the burette is filled from the prepared working solution.
    const solutionBlockers = solutionPreparationBlockers(session.config, session.public.solution);
    if (solutionBlockers.length > 0) return preparationRefusal(solutionBlockers[0]);
    const prep = session.public.stages[action.stageKey].preparation;
    if (!prep.buretteCleaned) {
      return preparationRefusal("Clean the burette with tap water before filling it.");
    }
    if (!prep.beakerObtained) {
      return preparationRefusal(
        "Obtain a portion of the working solution in a clean, dry beaker and cover it with a watch glass before filling the burette.",
      );
    }
    if (prep.conditioningRinses < REQUIRED_CONDITIONING_RINSES) {
      return preparationRefusal(
        `Condition the burette with NaOH before filling it (${prep.conditioningRinses} of ${REQUIRED_CONDITIONING_RINSES} rinses done).`,
      );
    }
    return null;
  }
  if (action.type === "start_trial") {
    const stage = session.public.stages[action.stageKey];
    if (action.trialNumber > 1 && !stage.preparation.lastTrialDiscarded) {
      return preparationRefusal(
        `Discard the completed trial into the waste container before starting trial ${action.trialNumber}.`,
      );
    }
    if (action.trialNumber === 1) {
      const blockers = preparationBlockersForTrial(
        session.config,
        action.stageKey,
        stage,
        session.public.solution,
      );
      if (blockers.length > 0) return preparationRefusal(blockers[0]);
    }
    return null;
  }
  return null;
}

/** Route one validated protocol action into the engine. Engine-only rejections. */
export function dispatchTitrationAction(
  session: TitrationSession,
  experimentId: string,
  action: TitrationProtocolAction,
): TitrationDispatchOutcome {
  // A client with a stale configuration could name a stage this attempt no
  // longer has. Reject it as a protocol problem rather than letting the engine
  // throw out of the caller.
  if (!(action.stageKey in session.public.stages)) {
    return {
      accepted: false,
      code: "unknown_stage",
      message: `This attempt has no stage named ${action.stageKey}`,
      colour: null,
      calculationCorrect: null,
    };
  }
  // Stage order is an experiment property, enforced for every caller (the
  // autosaving server action and any preview harness route through here): work
  // on a later stage is refused while an earlier stage is still incomplete.
  // The workflow is derived from public state only, so this check can neither
  // leak hidden values nor go stale.
  const workflow = projectExperimentWorkflow(session.config, projectPublicState(session));
  const stageStatus = workflow.stages.find((stage) => stage.key === action.stageKey);
  if (stageStatus?.locked) {
    return {
      accepted: false,
      code: "stage_locked",
      message:
        `Stage ${stageStatus.letter} (${stageStatus.title}) is locked. ` +
        `Complete Stage ${workflow.stages.find((s) => s.key === stageStatus.lockedByKey)?.letter ?? ""} (${stageStatus.lockedByTitle ?? "the earlier stage"}) first.`,
      colour: null,
      calculationCorrect: null,
    };
  }
  // Preparation procedure (Experiment 2, Part 2): a burette is filled only
  // after cleaning and conditioning, and a trial starts only after the full
  // preparation chain — or, for later trials, after the previous trial's
  // solution has been discarded into waste.
  const preparationGate = preparationGateFor(session, action);
  if (preparationGate) return preparationGate;
  switch (action.type) {
    case "setup_apparatus": {
      const result = setupApparatus(session, action.stageKey, action.titrantKey, action.initialReadingMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "weigh_analyte": {
      const result = weighAnalyte(session, action.stageKey, action.observedMassG);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "pipette_analyte": {
      const result = pipetteAnalyte(session, action.stageKey, action.observedVolumeMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "add_indicator": {
      const result = addIndicator(session, action.stageKey, action.drops);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "start_trial": {
      const result = startTrialAction(session, action.stageKey, action.trialNumber, action.initialReadingMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "add_titrant": {
      const result = addTitrant(session, action.stageKey, action.volumeMl);
      return result.ok ? acceptedOutcome({ colour: result.colour ?? null }) : rejected(result);
    }
    case "read_burette": {
      const result = readBurette(session, action.stageKey, action.observedFinalMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "observe_endpoint": {
      const result = observeEndpoint(session, action.stageKey, action.claimedColour);
      return result.ok ? acceptedOutcome({ colour: result.actual ?? null }) : rejected(result);
    }
    case "complete_trial": {
      const result = completeTrial(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "measure_naoh_stock": {
      const result = measureStockVolume(session, action.stageKey, action.observedVolumeMl);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "dilute_naoh_solution": {
      const result = diluteWorkingSolution(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "mix_naoh_solution": {
      const result = mixWorkingSolution(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "obtain_naoh_portion": {
      const result = obtainTitrantPortion(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "rinse_burette": {
      const result = rinseBurette(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "condition_burette": {
      const result = conditionBurette(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "clear_air_bubble": {
      const result = clearAirBubble(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "weigh_beaker": {
      const result = weighBeakerMass(session, action.stageKey, action.observedMassG);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "dissolve_khp": {
      const result = dissolveKhp(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "transfer_solution": {
      const result = transferSolution(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "rinse_beaker": {
      const result = rinseBeaker(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "place_flask": {
      const result = placeFlask(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "discard_to_waste": {
      const result = discardToWaste(session, action.stageKey);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
    case "report_molarity": {
      const result = reportMolarity(session, action.stageKey, action.trialNumber, action.studentMolarityM);
      // `expected` is stripped here: it must never cross to the browser.
      return result.ok
        ? acceptedOutcome({ calculationCorrect: result.correct ?? null })
        : rejected(result);
    }
    case "record_observation": {
      // Which observation fields exist is a property of the EXPERIMENT, not of
      // the titration engine, so it is enforced here: only a field the
      // experiment declares can ever reach storage.
      const declared = declaredObservationFieldsFor(experimentId);
      if (!declared.some((field) => field.fieldKey === action.fieldKey)) {
        return {
          accepted: false,
          code: "undeclared_observation_field",
          message: `This experiment has no observation field named ${action.fieldKey}`,
          colour: null,
          calculationCorrect: null,
        };
      }
      const result = recordObservation(session, action.stageKey, action.fieldKey, action.text);
      return result.ok ? acceptedOutcome() : rejected(result);
    }
  }
}
