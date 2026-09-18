"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi } from "./lab-state-provider";
import { ControlReason, describedBy } from "./control-reason";
import { selectionAvailability } from "./control-availability";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * Apparatus and reagent tray.
 *
 * The tray offers ONLY what the experiment's configuration defines: the titrant
 * and analyte of the active stage, that stage's indicator, and the apparatus the
 * stage's operations need. Nothing else can be selected, so no arbitrary
 * chemistry can be introduced from the browser.
 *
 * Selecting an item is a UI aid: it highlights the piece on the bench and
 * preselects the reagent for the burette. The engine still decides whether a
 * choice is valid when the action arrives (a wrong titrant is rejected).
 */
export function ApparatusTray({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const { selectedReagentKey, setSelectedReagentKey, selectedApparatusKey, setSelectedApparatusKey } =
    useLabUi();
  const { canWrite, pending } = useLabServer();
  const reasonId = `${useId()}-selection-reason`;

  if (!stage) return null;

  // Selecting an item drives the context panel; it records nothing, so the only
  // rule it can break is acting on a bench that cannot be written to.
  const availability = selectionAvailability({ canWrite, pending });
  const disabled = !availability.available;

  // Part I: the stock the working titrant is diluted from, offered only when the
  // experiment actually dilutes one.
  const stockKey = initialState.config.solutionDilution?.stockKey ?? null;
  const reagents = [
    ...(stockKey ? [{ key: stockKey, role: "stock", required: true }] : []),
    { key: stage.titrantKey, role: "titrant", required: true },
    { key: stage.analyteKey, role: "analyte", required: true },
    { key: stage.indicator.key, role: "indicator", required: true },
    { key: "distilled_water", role: "solvent", required: true },
  ];

  // The aliquot ware comes from the configuration, so the tray never offers a
  // pipette for a procedure that specifies a measuring cylinder.
  const apparatus = [
    { key: `burette_${Math.round(stage.burette.capacityMl)}`, detail: `${stage.burette.capacityMl} mL, to ${stage.burette.graduationMl} mL` },
    { key: "conical_flask_250", detail: "titration vessel" },
    stage.portion.kind === "weighed_mass"
      ? { key: "analytical_balance", detail: `to ${stage.portion.precision} g` }
      : { key: stage.portion.vessel, detail: `${stage.portion.nominalVolumeMl} mL aliquot` },
    ...(stage.portion.kind === "weighed_mass"
      ? [{ key: "weighing_bottle", detail: "sample container" }]
      : stage.portion.vessel === "pipette"
        ? [{ key: "pipette_filler", detail: "never pipette by mouth" }]
        : [{ key: "beaker_250", detail: "receives the aliquot" }]),
    { key: "wash_bottle", detail: "distilled water rinsings" },
  ];

  const label = (key: string) =>
    initialState.chemicalLabels[key] ?? initialState.apparatusLabels[key] ?? key.replace(/_/g, " ");

  return (
    <section aria-label="Apparatus and reagents" className="flex flex-col gap-3 text-sm">
      <ControlReason id={reasonId} reason={availability.reason} />
      <div>
        <h3 className="text-sm font-semibold">Reagents</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {reagents.map((reagent) => {
            const selected = selectedReagentKey === reagent.key;
            return (
              <li key={reagent.key} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {label(reagent.key)}
                  <span className="ml-2 text-xs text-muted">{reagent.role}</span>
                </span>
                <Button
                  size="sm"
                  variant={selected ? "primary" : "secondary"}
                  aria-pressed={selected}
                  disabled={disabled}
                  aria-describedby={describedBy(reasonId, availability)}
                  onClick={() => setSelectedReagentKey(selected ? null : reagent.key)}
                >
                  {selected ? "Selected" : "Select"}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Apparatus</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {apparatus.map((item) => {
            const selected = selectedApparatusKey === item.key;
            return (
              <li key={item.key} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {label(item.key)}
                  <span className="ml-2 text-xs text-muted">{item.detail}</span>
                </span>
                <Button
                  size="sm"
                  variant={selected ? "primary" : "secondary"}
                  aria-pressed={selected}
                  disabled={disabled}
                  aria-describedby={describedBy(reasonId, availability)}
                  onClick={() => setSelectedApparatusKey(selected ? null : item.key)}
                >
                  {selected ? "Selected" : "Select"}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
