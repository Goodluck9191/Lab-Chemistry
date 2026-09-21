"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useActiveStage, useLabUi } from "./lab-state-provider";
import {
  AnalyteSection,
  BurettePreparationSection,
  BuretteSetupSection,
  FlaskPlacementSection,
  IndicatorSection,
  SolutionPreparationSection,
} from "./preparation-controls";
import {
  DeliverySection,
  DiscardSection,
  ObserveSection,
  ReadingSection,
} from "./titration-controls";
import { ALIQUOT_VESSEL_COPY, type StageView } from "./view-model";
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
  const { selectedApparatusKey, selectedReagentKey } = useLabUi();

  if (!stage) return null;

  const focus = resolveFocus(stage, selectedApparatusKey, selectedReagentKey, initialState);

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

      <FullPreparation initialState={initialState} />
      <FullTitration />
    </section>
  );
}

function FullPreparation({ initialState }: { initialState: LabStateView }) {
  return (
    <div className="flex flex-col gap-3">
      <SolutionPreparationSection />
      <BurettePreparationSection />
      <BuretteSetupSection initialState={initialState} />
      <AnalyteSection initialState={initialState} />
      <IndicatorSection />
      <FlaskPlacementSection />
    </div>
  );
}

function FullTitration() {
  return (
    <div className="flex flex-col gap-3">
      <DeliverySection />
      <ObserveSection />
      <ReadingSection />
      <DiscardSection />
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
): Focus | null {
  // A reagent selection focuses the instrument that uses it.
  if (selectedReagentKey) {
    if (selectedReagentKey === initialState.config.solutionDilution?.stockKey) {
      return {
        kind: "preparation",
        title: "Prepare the working solution",
        description:
          "Part I: measure the stock solution, dilute it with distilled water and mix it before any burette work.",
        section: <SolutionPreparationSection />,
      };
    }
    if (selectedReagentKey === stage.titrantKey) {
      return {
        kind: "preparation",
        title: "Prepare the burette",
        description: `Clean and condition it, then fill with the selected titrant and record the initial reading.`,
        section: (
          <>
            <BurettePreparationSection />
            <div className="mt-3">
              <BuretteSetupSection initialState={initialState} />
            </div>
          </>
        ),
      };
    }
    if (selectedReagentKey === stage.analyteKey) {
      return {
        kind: "preparation",
        title: "Measure the sample",
        description:
          stage.portion.kind === "weighed_mass"
            ? "Weigh the primary standard and record the mass."
            : `Measure the aliquot with the ${ALIQUOT_VESSEL_COPY[stage.portion.vessel].name} and record the volume.`,
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
        title: "Prepare the burette",
        description: "Clean and condition it, fill with the titrant, record the initial reading, then clear the tip.",
        section: (
          <>
            <BurettePreparationSection />
            <div className="mt-3">
              <BuretteSetupSection initialState={initialState} />
            </div>
          </>
        ),
      };
    case "graduated_cylinder":
    case "pipette":
      return {
        kind: "preparation",
        title:
          selectedApparatusKey === "pipette" ? "Pipette the aliquot" : "Measure the aliquot",
        description: ALIQUOT_VESSEL_COPY[selectedApparatusKey].nextDescription,
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
          "Made up to the mark when a standard solution is prepared to an exact volume. The manual dilutes the working solution in a clean flask and standardises by weighing, so this flask stays in reserve.",
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