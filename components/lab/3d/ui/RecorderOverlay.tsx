"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useActiveStage,
  useLabServer,
  useLabUi,
  useLabViewModel,
  type RecorderKind,
} from "../../lab-state-provider";
import { ReadingInput, readingIsUsable, type ReadingKind } from "../../reading-input";

/**
 * The recording station (§28).
 *
 * ONE recorder, several subjects: the simulator provides the observation (the
 * balance display, the meniscus on the scale, the level in the cylinder) and the
 * student writes down what they read. Nothing here computes a value or presents
 * an answer — it only carries a number the student typed to the same protocol
 * action the accessible panels use, so there is still exactly one persistence
 * path. The server records the student's number beside the instrument's own and
 * keeps the deviation for assessment.
 */
interface RecorderSpec {
  kind: RecorderKind;
  title: string;
  readingKind: ReadingKind;
  unit: string;
  hint: string;
}

export function recorderSpecsFor(args: {
  stage:
    | {
        key: string;
        portion:
          | { kind: "weighed_mass"; recordedMassG: number | null }
          | { kind: "pipetted_volume"; recordedVolumeMl: number | null };
        preparationState: { beakerMassG: number | null; beakerPlusKhpMassG: number | null };
        burette: { setup: boolean; readingPrecisionMl: number };
        openTrial: { trialNumber: number; finalReadingMl: number | null } | null;
        nextTrialNumber: number | null;
      }
    | null
    | undefined;
  solution: { required: boolean; stockVolumeMl: number | null };
}): RecorderSpec[] {
  const { stage, solution } = args;
  if (!stage) return [];
  const specs: RecorderSpec[] = [];

  if (solution.required && solution.stockVolumeMl === null) {
    specs.push({
      kind: "cylinder_stock_volume",
      title: "Stock volume measured in the cylinder",
      readingKind: "volume",
      unit: "mL",
      hint: "Record the volume you measured off the cylinder, to two decimal places.",
    });
  }

  if (stage.openTrial === null && stage.nextTrialNumber !== null && stage.burette.setup) {
    specs.push({
      kind: "burette_initial",
      title: `Initial burette reading for trial ${stage.nextTrialNumber}`,
      readingKind: "burette",
      unit: "mL",
      hint: `Read the bottom of the meniscus against the scale, to ${stage.burette.readingPrecisionMl} mL.`,
    });
  }

  if (stage.openTrial !== null && stage.openTrial.finalReadingMl === null) {
    specs.push({
      kind: "burette_final",
      title: `Final burette reading for trial ${stage.openTrial.trialNumber}`,
      readingKind: "burette",
      unit: "mL",
      hint: `Read the bottom of the meniscus against the scale, to ${stage.burette.readingPrecisionMl} mL.`,
    });
  }

  if (stage.portion.kind === "weighed_mass") {
    if (stage.preparationState.beakerMassG === null) {
      specs.push({
        kind: "beaker_empty_mass",
        title: "Mass of the empty beaker on the pan",
        readingKind: "mass",
        unit: "g",
        hint: "Record the mass the balance displays, to two decimal places.",
      });
    } else if (stage.preparationState.beakerPlusKhpMassG === null) {
      specs.push({
        kind: "beaker_loaded_mass",
        title: "Mass of the beaker plus the standard",
        readingKind: "mass",
        unit: "g",
        hint: "Record the new mass the balance displays, to two decimal places.",
      });
    }
  } else if (stage.portion.kind === "pipetted_volume" && stage.portion.recordedVolumeMl === null) {
    specs.push({
      kind: "cylinder_aliquot_volume",
      title: "Volume of aliquot delivered to the flask",
      readingKind: "volume",
      unit: "mL",
      hint: "Record the volume you actually delivered, to two decimal places.",
    });
  }

  return specs;
}

function actionFor(
  kind: RecorderKind,
  stageKey: string,
  trialNumber: number | null,
  value: number,
): ({ type: string } & Record<string, unknown>) | null {
  switch (kind) {
    case "burette_initial":
      return trialNumber === null
        ? null
        : { type: "start_trial", stageKey, trialNumber, initialReadingMl: value };
    case "burette_final":
      return { type: "read_burette", stageKey, observedFinalMl: value };
    case "beaker_empty_mass":
    case "beaker_loaded_mass":
      return { type: "weigh_beaker", stageKey, observedMassG: value };
    case "cylinder_stock_volume":
      return { type: "measure_naoh_stock", stageKey, observedVolumeMl: value };
    case "cylinder_aliquot_volume":
      return { type: "pipette_analyte", stageKey, observedVolumeMl: value };
    case "endpoint_colour":
      return null;
  }
}

export function RecorderOverlay() {
  const stage = useActiveStage();
  const solution = useLabViewModel().solution;
  const { perform, pending, canWrite } = useLabServer();
  const { recorder, setRecorder, activeStageKey } = useLabUi();
  const [values, setValues] = useState<Record<string, string>>({});
  const uid = useId();

  if (recorder === null || !stage) return null;

  const specs = recorderSpecsFor({ stage, solution });
  const spec = specs.find((entry) => entry.kind === recorder) ?? null;
  const blocked = !canWrite || pending;

  const close = () => {
    setValues({});
    setRecorder(null);
  };

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-20 z-40 w-80 max-w-[85vw] -translate-x-1/2 rounded-lg border border-line bg-surface p-3 shadow-lg"
      role="dialog"
      aria-label="Record a reading"
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">Record a reading</p>
        <Button size="sm" variant="ghost" className="ms-auto h-6 px-2 text-[11px]" onClick={close}>
          Close
        </Button>
      </div>

      {spec === null ? (
        <p className="mt-1 text-xs text-muted">
          There is nothing to record on this stage right now. Run the step that produces the
          reading first.
        </p>
      ) : (
        <div className="mt-2">
          <p className="text-xs font-medium">{spec.title}</p>
          <p className="mt-0.5 text-[11px] text-muted">{spec.hint}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <ReadingInput
              id={`recorder-${uid}-${spec.kind}`}
              label="Your reading"
              kind={spec.readingKind}
              unit={spec.unit}
              value={values[spec.kind] ?? ""}
              onChange={(next) => setValues((current) => ({ ...current, [spec.kind]: next }))}
              disabled={blocked}
              className="w-48"
            />
            <Button
              size="sm"
              disabled={blocked || !readingIsUsable(values[spec.kind] ?? "", spec.readingKind)}
              onClick={async () => {
                const value = Number(values[spec.kind]);
                const action = actionFor(
                  spec.kind,
                  activeStageKey,
                  stage.openTrial?.trialNumber ?? stage.nextTrialNumber,
                  value,
                );
                if (action === null) return;
                await perform(action);
                close();
              }}
            >
              Save reading
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
