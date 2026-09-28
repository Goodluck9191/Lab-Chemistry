/**
 * The one line the laboratory says about what is under the crosshair.
 *
 * A physical gesture that refuses is worse than a greyed-out button: the button
 * at least says why. So the contextual hint carries the same sentence the panel
 * would show, for the two places a student gets stuck without it — the burette
 * valve, which will not turn until the stage is prepared, and the indicator,
 * whose action is only reachable once the dropper is in their hand.
 *
 * Pure: it reads a stage view and two flags and returns a string or null. The
 * reasons are the gates' own (`stopcockAvailability`), so the sentence on screen
 * cannot outlive the rule behind it.
 */

import type { StageView } from "../../view-model";
import { mountLabel } from "../interactions/mounting";
import type { HoldableKind } from "../interactions/carry";
import { stopcockAvailability, type LabControlFlags } from "../../control-availability";
import type { PhysicalSelectionKey } from "../simulation/apparatus-state";

export interface InteractionHintArgs {
  /** What the crosshair (or the selection) is on. */
  subject: PhysicalSelectionKey;
  /** What is in the student's hand, if anything. */
  carried: HoldableKind | null;
  /** The stage the bench is working in, if any. */
  stage: StageView | null;
  flags: LabControlFlags;
}

export function interactionHintFor(args: InteractionHintArgs): string | null {
  // A hand that is already full is explained by the holding line in the HUD.
  if (args.carried !== null || args.stage === null) return null;
  const stage = args.stage;

  if (args.subject === "burette") {
    const valve = stopcockAvailability(stage, args.flags);
    // Shut or not, the valve's own gate has the last word on whether it turns.
    if (!valve.available) return valve.reason;
    return mountLabel(stage.burette.setup);
  }

  // The next step is the indicator, and it is added by hand: say where the
  // dropper is, rather than letting the student hunt through the action card.
  const indicatorNext = stage.nextAction?.kind === "add_indicator";
  if (indicatorNext && (args.subject === "reagent_bottle" || args.subject === "conical_flask")) {
    const [min, max] = stage.indicator.dropsRange;
    return `Lift the ${stage.indicator.name} dropper and tip it over the flask — ${min}–${max} drops.`;
  }

  return null;
}
