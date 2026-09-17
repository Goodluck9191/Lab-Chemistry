/**
 * Protocol action router: one validated action in, one engine call out.
 *
 * This is the ONLY place a protocol action is mapped onto a domain function, so
 * every caller — the autosaving server action and the development-only preview
 * harness — routes actions identically and cannot drift apart. It performs no
 * persistence, reads no environment, and imports nothing server-only.
 *
 * Two checks belong here rather than in the engine, because they are properties
 * of the EXPERIMENT or the client rather than of the titration chemistry:
 *
 *  - a stale client naming a stage this attempt no longer has is rejected as a
 *    protocol problem instead of throwing out of the caller;
 *  - an observation may only name a field the experiment declares.
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
  completeTrial,
  observeEndpoint,
  pipetteAnalyte,
  readBurette,
  recordObservation,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  weighAnalyte,
  type ActionResult,
  type TitrationSession,
} from "./engine";

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
