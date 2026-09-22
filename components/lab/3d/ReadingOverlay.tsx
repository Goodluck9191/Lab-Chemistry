"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi } from "../lab-state-provider";
import { ReadingInput, readingIsUsable } from "../reading-input";
import { readingAvailability } from "../control-availability";

/**
 * Minimal burette-reading overlay for the 3D laboratory (§38).
 *
 * A small card over the scene — never a dashboard: the student types what THEY
 * read from the 3D meniscus and records it, then returns straight to the
 * world. The value is validated for shape here and for truth server-side by
 * the existing `read_burette` action; nothing is revealed before submission.
 */
export function ReadingOverlay({ onClose }: { onClose: () => void }) {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { activeStageKey, stopcockOpenForStage } = useLabUi();
  const [observed, setObserved] = useState("");

  if (!stage) return null;
  const availability = readingAvailability(stage, {
    canWrite,
    pending,
    stopcockOpen: stopcockOpenForStage === activeStageKey,
  });
  const openTrial = stage.openTrial;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-24 z-20 w-64 -translate-x-1/2 rounded-lg border border-line bg-surface p-3 shadow-lg"
      role="dialog"
      aria-label="Record burette reading"
    >
      <p className="text-sm font-semibold">Burette reading</p>
      {openTrial ? (
        <>
          <p className="mt-0.5 text-xs text-muted">
            Trial {openTrial.trialNumber}: read the bottom of the meniscus, to{" "}
            {stage.burette.readingPrecisionMl} mL.
          </p>
          <div className="mt-2 flex items-end gap-2">
            <ReadingInput
              id="immersive-reading"
              label="Observed reading"
              kind="burette"
              value={observed}
              onChange={setObserved}
              disabled={!canWrite || pending}
              className="flex-1"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={!availability.available || !readingIsUsable(observed, "burette")}
              onClick={async () => {
                await perform({
                  type: "read_burette",
                  stageKey: activeStageKey,
                  observedFinalMl: Number(observed),
                });
                setObserved("");
                onClose();
              }}
            >
              Record
            </Button>
            <Button size="sm" variant="secondary" onClick={onClose}>
              Back to lab
            </Button>
          </div>
          {availability.reason ? (
            <p className="mt-1 text-xs text-muted">{availability.reason}</p>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted">
            No trial is running, so there is no burette reading to record.
          </p>
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={onClose}>
              Back to lab
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
