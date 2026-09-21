/**
 * Action feedback: what the laboratory says it just did, in chemistry terms.
 *
 * WHY THIS IS A SEPARATE MODULE: "Success!" teaches nothing, and a component is
 * the wrong place to decide whether a titration has started, a stream is
 * running or a trial has been rejected. This is a pure function of two things
 * only:
 *
 *   1. the action the student just sent — their own words and numbers, and
 *   2. the PUBLIC state and outcome the server returned.
 *
 * It therefore cannot invent a value, count a delivery that was never accepted,
 * or reveal anything hidden: a refusal is deliberately NOT worded here, because
 * the engine's own student-facing message is surfaced by `LabNotices`, and
 * saying it twice (once in the alert, once here) would be noise.
 *
 * A save failure is also not worded here. The controller clears the stream
 * instead, so the laboratory never claims an action was recorded when the
 * database never confirmed it.
 */
import type { TitrationPublicState } from "@/domain/simulation/titration/engine";
import { FLASK_COLOUR_LABELS } from "./view-model";

export type ActionFeedbackTone = "info" | "success" | "warning" | "danger";

export interface ActionFeedback {
  tone: ActionFeedbackTone;
  message: string;
}

/** The action object the controller holds, before it becomes an envelope. */
export type LabActionInput = { type: string } & Record<string, unknown>;

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Readings are committed to two decimal places, so they are echoed that way. */
function ml(value: number): string {
  return `${value.toFixed(2)} mL`;
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function colourLabel(colour: unknown): string | null {
  const key = text(colour);
  if (!key || !(key in FLASK_COLOUR_LABELS)) return null;
  return lowercaseFirst(FLASK_COLOUR_LABELS[key as keyof typeof FLASK_COLOUR_LABELS]);
}

/**
 * A colour the student can already see on the bench: faint pink marks the
 * endpoint, deeper pink means the endpoint has been passed.
 */
function colourTone(colour: string | null): ActionFeedbackTone {
  switch (colour) {
    case "faint_pink":
      return "success";
    case "pink":
    case "deep_pink":
      return "warning";
    default:
      return "info";
  }
}

/** What is happening right now, while the action is in flight. */
export function feedbackForStart(action: LabActionInput): string {
  switch (action.type) {
    case "setup_apparatus":
      return "Rinsing and filling the burette…";
    case "weigh_analyte":
      return "Recording the mass…";
    case "pipette_analyte":
      return "Recording the delivered volume…";
    case "add_indicator":
      return "Adding the indicator to the flask…";
    case "start_trial":
      return "Starting the trial…";
    case "add_titrant":
      return "Titrant running into the flask…";
    case "read_burette":
      return "Recording the burette reading…";
    case "observe_endpoint":
      return "Recording what you saw…";
    case "complete_trial":
      return "Closing the trial and judging the endpoint…";
    case "report_molarity":
      return "Submitting your calculation…";
    case "record_observation":
      return "Saving your observation…";
    case "measure_naoh_stock":
      return "Recording the volume of stock solution you measured…";
    case "dilute_naoh_solution":
      return "Adding distilled water to the dilution…";
    case "mix_naoh_solution":
      return "Stoppering and swirling to mix the working solution…";
    case "obtain_naoh_portion":
      return "Drawing a portion of the working solution into the beaker…";
    case "rinse_burette":
      return "Rinsing the burette with tap water…";
    case "condition_burette":
      return "Conditioning the burette with NaOH…";
    case "clear_air_bubble":
      return "Clearing the burette tip…";
    case "weigh_beaker":
      return "Recording the beaker weighing…";
    case "dissolve_khp":
      return "Dissolving the KHP…";
    case "transfer_solution":
      return "Transferring the solution to the flask…";
    case "rinse_beaker":
      return "Rinsing the beaker into the flask…";
    case "place_flask":
      return "Placing the flask under the burette…";
    case "discard_to_waste":
      return "Discarding into the waste container…";
    default:
      return "Saving…";
  }
}

/** Reported when the client's revision was stale and the state was reloaded. */
export const CONFLICT_FEEDBACK: ActionFeedback = {
  tone: "info",
  message:
    "This attempt changed in another session, so the saved state was reloaded. Nothing was " +
    "overwritten — check the readings and repeat the action if it is still needed.",
};

/**
 * Word an ACCEPTED action. Returns null for an action the engine refused or a
 * type this module has no honest wording for — an unknown action must produce
 * silence rather than an invented sentence.
 */
export function feedbackForOutcome(input: {
  action: LabActionInput;
  accepted: boolean;
  colour: string | null;
  calculationCorrect: boolean | null;
  publicState: TitrationPublicState;
}): ActionFeedback | null {
  if (!input.accepted) return null;
  const { action } = input;

  switch (action.type) {
    case "setup_apparatus": {
      const reading = numeric(action.initialReadingMl);
      return {
        tone: "success",
        message:
          reading === null
            ? "Burette rinsed, filled and clamped."
            : `Burette rinsed, filled and clamped. Initial reading ${ml(reading)} recorded.`,
      };
    }

    case "weigh_analyte": {
      const mass = numeric(action.observedMassG);
      return {
        tone: "success",
        message:
          mass === null
            ? "The mass you read was recorded."
            : `Sample weighed. ${mass} g recorded on the balance.`,
      };
    }

    case "pipette_analyte": {
      const volume = numeric(action.observedVolumeMl);
      return {
        tone: "success",
        message:
          volume === null
            ? "The delivered volume was recorded."
            : `Aliquot delivered with the pipette. ${ml(volume)} recorded.`,
      };
    }

    case "add_indicator": {
      const drops = numeric(action.drops);
      return {
        tone: "success",
        message:
          drops === null
            ? "Indicator added to the flask."
            : `${drops} ${drops === 1 ? "drop" : "drops"} of indicator added to the flask.`,
      };
    }

    case "start_trial": {
      const trialNumber = numeric(action.trialNumber);
      const reading = numeric(action.initialReadingMl);
      if (trialNumber === null) return { tone: "info", message: "The trial has started." };
      return {
        tone: "info",
        message:
          reading === null
            ? `Trial ${trialNumber} started.`
            : `Trial ${trialNumber} started from an initial reading of ${ml(reading)}.`,
      };
    }

    case "add_titrant": {
      const volume = numeric(action.volumeMl);
      const colour = colourLabel(input.colour);
      const delivered =
        volume === null ? "Titrant delivered." : `Titrant delivered: ${ml(volume)}.`;
      return {
        tone: colourTone(input.colour),
        message: colour === null ? delivered : `${delivered} The flask is now ${colour}.`,
      };
    }

    case "read_burette": {
      const reading = numeric(action.observedFinalMl);
      return {
        tone: "success",
        message:
          reading === null
            ? "Final burette reading recorded."
            : `Final burette reading recorded: ${ml(reading)}.`,
      };
    }

    case "observe_endpoint": {
      const actual = colourLabel(input.colour);
      const claimed = colourLabel(action.claimedColour);
      if (actual === null) return { tone: "success", message: "Your observation was recorded." };
      if (claimed !== null && claimed !== actual) {
        return {
          tone: "warning",
          message: `Observation recorded. You reported ${claimed}, but the flask showed ${actual}.`,
        };
      }
      return { tone: "success", message: `Observation recorded: the flask is ${actual}.` };
    }

    case "complete_trial":
      return completeTrialFeedback(action, input.publicState);

    case "report_molarity": {
      const trialNumber = numeric(action.trialNumber);
      const submitted =
        trialNumber === null
          ? "Concentration submitted."
          : `Concentration submitted for trial ${trialNumber}.`;
      if (input.calculationCorrect === true) {
        return { tone: "success", message: `${submitted} It agrees with the laboratory's check.` };
      }
      if (input.calculationCorrect === false) {
        return {
          tone: "warning",
          message: `${submitted} It falls outside the accepted tolerance — recheck your arithmetic and the readings you used.`,
        };
      }
      return { tone: "info", message: submitted };
    }

    case "measure_naoh_stock": {
      const volume = numeric(action.observedVolumeMl);
      return {
        tone: "success",
        message:
          volume === null
            ? "The stock volume you measured was recorded."
            : `${ml(volume)} of stock solution measured and recorded for the dilution.`,
      };
    }

    // Part I wording names the step, never a concentration: the procedure
    // specifies no final strength for the prepared solution.
    case "dilute_naoh_solution":
      return { tone: "success", message: "Distilled water added to complete the dilution." };

    case "mix_naoh_solution":
      return {
        tone: "success",
        message: "The flask was stoppered and swirled, so the working solution is mixed.",
      };

    case "obtain_naoh_portion":
      return {
        tone: "success",
        message: "A portion of the working solution is in the beaker, covered with a watch glass.",
      };

    case "record_observation":
      return { tone: "success", message: "Your observation was saved." };

    default:
      return null;
  }
}

/**
 * Closing a trial is the one action whose outcome the engine reports as accepted
 * either way: the trial is recorded, or it is rejected for overshooting. Which
 * happened is read from the public state the server returned, never guessed.
 */
function completeTrialFeedback(
  action: LabActionInput,
  publicState: TitrationPublicState,
): ActionFeedback {
  const stageKey = text(action.stageKey);
  const stage = stageKey === null ? undefined : publicState.stages[stageKey];
  const latest = stage?.trials.at(-1);
  if (!latest) return { tone: "info", message: "The trial was closed." };

  if (latest.status === "discarded_overshoot") {
    return {
      tone: "danger",
      message: `Trial ${latest.trialNumber} rejected — the titration was carried past the endpoint. Discard the solution and repeat the trial.`,
    };
  }
  if (latest.status === "rejected") {
    return {
      tone: "warning",
      message: `Trial ${latest.trialNumber} was rejected. Check your readings and repeat it.`,
    };
  }

  const titre =
    latest.deliveredMl === null ? "" : ` ${ml(latest.deliveredMl)} of titrant delivered.`;
  if (latest.endpointJudgement === "undertitrated") {
    return {
      tone: "warning",
      message: `Trial ${latest.trialNumber} recorded.${titre} You stopped before the endpoint, so this titre is low.`,
    };
  }
  return { tone: "success", message: `Trial ${latest.trialNumber} recorded.${titre}` };
}
