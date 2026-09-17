"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useActiveStage, useLabUi } from "./lab-state-provider";
import {
  AnalyteSection,
  BuretteSetupSection,
  IndicatorSection,
} from "./preparation-controls";
import {
  DeliverySection,
  ObserveSection,
  ReadingSection,
} from "./titration-controls";
import type {
  StageView,
} from "./view-model";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * Contextual action panel (right rail, desktop).
 *
 * Selecting an apparatus or reagent on the bench brings its related controls to
 * the top of the panel as a focused section, so what the student is looking at
 * and the instrument steps that apply sit next to each other. The remaining
 * funnel stays visible below — a selection reorders the steps, it never hides a
 * step that is still needed.
 *
 * Every section rendered here (both the focused one and the funnel) is an
 * existing preparation/titration section component, so the contextual panel
 * cannot diverge from the real flow the mobile and full views use.
 */
export function ActionPanel({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const { selectedApparatusKey, selectedReagentKey, fillerAttached } = useLabUi();

  if (!stage) return null;

  const focus = resolveFocus(
    stage,
    selectedApparatusKey,
    selectedReagentKey,
    initialState,
    fillerAttached,
  );

  const preparationIsFocused = focus !== null && focus.kind === "preparation";

  return (
    <section aria-label="Instrument actions" className="flex flex-col gap-2">
      {focus ? (
        <div className="rounded-md border border-primary/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Selected: {focus.title}
            </p>
            <Badge tone="success">In context</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">{focus.description}</p>
        </div>
      ) : (
        <p className="px-1 text-xs text-muted">
          Select an apparatus or reagent on the bench to bring its controls into context.
        </p>
      )}

      {focus?.section}

      {preparationIsFocused ? null : (
        <FullPreparation initialState={initialState} />
      )}
      <FullTitration />
    </section>
  );
}

function FullPreparation({ initialState }: { initialState: LabStateView }) {
  return (
    <div className="flex flex-col gap-3">
      <BuretteSetupSection initialState={initialState} />
      <AnalyteSection initialState={initialState} />
<IndicatorSection />
    </div>
  );
}

function FullTitration() {
  return (
    <div className="flex flex-col gap-3">
      <DeliverySection />
      <ObserveSection />
      <ReadingSection />
    </div>
  );
}

interface Focus {
  kind: "preparation" | "titration";
  title: string;
  description: string;
  section: ReactNode;
}

function resolveFocus(
  stage: StageView,
  selectedApparatusKey: string | null,
  selectedReagentKey: string | null,
  initialState: LabStateView,
  fillerAttached: boolean,
): Focus | null {
  // A reagent selection focuses the instrument that uses it.
  if (selectedReagentKey) {
    if (selectedReagentKey === stage.titrantKey) {
      return {
        kind: "preparation",
        title: "Rinse, fill and clamp the burette",
        description: `Fill the burette with the selected titrant, then record the initial reading.`,
        section: <BuretteSetupSection initialState={initialState} />,
      };
    }
    if (selectedReagentKey === stage.analyteKey) {
      return {
        kind: "preparation",
        title: "Measure the sample",
        description:
          stage.portion.kind === "weighed_mass"
            ? "Weigh the primary standard and record the mass."
            : "Deliver the aliquot with the pipette and record the volume.",
        section: <AnalyteSection initialState={initialState} />,
      };
    }
    if (selectedReagentKey === stage.indicator.key) {
      return {
        kind: "preparation",
        title: "Add the indicator",
        description: `Add ${stage.indicator.dropsRange[0]}–${stage.indicator.dropsRange[1]} drops to the flask.`,
        section: <IndicatorSection />,
      };
    }
    return {
      kind: "preparation",
      title: "Reagent selected",
      description: "Distilled water fills the wash bottle — use it for rinsings.",
      section: null,
    };
  }

  switch (selectedApparatusKey) {
    case "burette":
      return {
        kind: "preparation",
        title: "Rinse, fill and clamp the burette",
        description: "Fill with the titrant and record the initial reading to close this section.",
        section: <BuretteSetupSection initialState={initialState} />,
      };
    case "pipette":
      return {
        kind: "preparation",
        title: "Pipette the aliquot",
        description: fillerAttached
          ? "Filler attached. Draw up the solution with the filler, then deliver into the flask."
          : "Attach the filler first, then draw up the solution and deliver into the flask.",
        section: <AnalyteSection initialState={initialState} />,
      };
    case "analytical_balance":
      return {
        kind: "preparation",
        title: "Weigh the sample",
        description: "Use the tare and add the standard; record the mass you read.",
        section: <AnalyteSection initialState={initialState} />,
      };
    case "conical_flask":
      return {
        kind: "titration",
        title: "Titrate in the flask",
        description: "Deliver titrant while swirling, then record the colour you observe. The titration controls below are the flask's actions.",
        section: null,
      };
    case "beaker":
      return {
        kind: "preparation",
        title: "Beaker",
        description:
          "Holds rinsings and intermediate solutions. It takes no measurement in this practical — prepare the sample in the section below.",
        section: null,
      };
    case "volumetric_flask":
      return {
        kind: "preparation",
        title: "Volumetric flask",
        description:
          "Made up to the mark when a standard solution is prepared by volume. This experiment standardises by weighing and pipetting, so the flask stays in reserve.",
        section: null,
      };
    case "waste_container": {
      const discarded = stage.concordance.discardedTrials.length;
      return {
        kind: "titration",
        title: "Waste container",
        description:
          discarded === 0
            ? "Overshot or rejected trials are discarded here. Nothing discarded yet."
            : `Overshot or rejected trials are discarded here. ${discarded} trial${discarded === 1 ? "" : "s"} discarded so far.`,
        section: null,
      };
    }
    default:
      return null;
  }
}