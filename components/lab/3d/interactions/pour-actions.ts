/**
 * What a completed pour MEANS, given what is being poured and into what.
 *
 * Only pours the domain already models as a single action are mapped: tipping
 * the dissolved-KHP beaker into the flask is the transfer (or a rinse, if that
 * is what is outstanding), and tipping the phenolphthalein dropper into the
 * flask is the indicator — with the drop count the gesture produced, clamped
 * into the range the experiment documents. Actions that need a RECORDED volume
 * — measuring stock, pipetting the aliquot — deliberately stay with the
 * recorder, because a student must read and enter those numbers rather than
 * have the gesture invent them.
 *
 * It lives outside the component on purpose: the rule is chemistry-facing, so
 * it is unit-tested against real stage views instead of being discovered by
 * pouring glassware in a browser.
 */

import {
  indicatorAvailability,
  rinseBeakerAvailability,
  transferAvailability,
  type LabControlFlags,
} from "../../control-availability";
import type { StageView } from "../../view-model";
import { clampDropsToRange } from "./drops";
import type { HoldableKind } from "./carry";
import type { PourZone } from "./pour";

export interface PourFlags extends LabControlFlags {
  /** Drops the gesture released, when the held object is a dropper. */
  dropsPoured: number;
}

/**
 * The action a completed pour sends, or null when the domain accepts none of
 * them. Every branch is gated by the same availability rule the panel button
 * uses, so a gesture can never reach further than a click can.
 */
export function pourActionFor(
  kind: HoldableKind,
  zone: PourZone,
  flags: PourFlags & { stage: StageView },
): ({ type: string } & Record<string, unknown>) | null {
  const gate: LabControlFlags = { canWrite: flags.canWrite, pending: flags.pending };
  if (kind === "beaker" && zone === "flask") {
    if (transferAvailability(flags.stage, gate).available) {
      return { type: "transfer_solution", stageKey: flags.stage.key };
    }
    if (rinseBeakerAvailability(flags.stage, gate).available) {
      return { type: "rinse_beaker", stageKey: flags.stage.key };
    }
    return null;
  }
  if (kind === "indicator" && zone === "flask") {
    if (indicatorAvailability(flags.stage, gate).available) {
      return {
        type: "add_indicator",
        stageKey: flags.stage.key,
        drops: clampDropsToRange(flags.dropsPoured, flags.stage.indicator.dropsRange),
      };
    }
    return null;
  }
  return null;
}

/**
 * What to say when a pour resolved to nothing.
 *
 * A pour the domain refuses is still a physical act the student performed, and
 * silence reads as a broken laboratory. The reasons are the gates' own, so the
 * sentence on screen can never outlive the rule behind it. A beaker whose
 * transfer and rinses are both done says nothing: there is no pour left to make,
 * and the student is simply handling glassware.
 */
export function pourRefusalFor(
  kind: HoldableKind,
  zone: PourZone,
  flags: PourFlags & { stage: StageView },
): string | null {
  const gate: LabControlFlags = { canWrite: flags.canWrite, pending: flags.pending };
  if (kind === "indicator" && zone === "flask") {
    return indicatorAvailability(flags.stage, gate).reason;
  }
  if (kind === "beaker" && zone === "flask") {
    const prep = flags.stage.preparationState;
    if (prep.khpTransferred && prep.beakerRinses >= 2) return null;
    return (
      transferAvailability(flags.stage, gate).reason ??
      rinseBeakerAvailability(flags.stage, gate).reason
    );
  }
  return null;
}
