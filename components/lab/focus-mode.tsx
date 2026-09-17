"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi } from "./lab-state-provider";
import { BuretteSvg } from "./svg/burette-svg";
import { BuretteSetupSection } from "./preparation-controls";
import { ReadingSection, StartTrialControl } from "./titration-controls";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * Burette focus mode.
 *
 * Selecting "Enlarge burette" on the bench (or activating the burette) opens an
 * overlay whose single job is to help the student READ the meniscus precisely.
 * The burette is drawn large enough that the scale is full width of the dialog,
 * yet the drawing is still illustrative: the actual value the student commits is
 * the number they type, which the engine compares against what it delivered.
 *
 * The actions offered here are the two reading-bound moments of a titration —
 * the initial reading (filling the burette) and the final reading (closing the
 * trial). Both go through the normal action pipeline; nothing in this overlay
 * bypasses the server.
 */
export function FocusMode({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const { focusedApparatus, setFocusedApparatus, activeStageKey, stopcockOpenForStage, toggleStopcock } =
    useLabUi();
  const { canWrite, pending } = useLabServer();

  useEffect(
    function closeOnEscape() {
      if (focusedApparatus !== "burette") return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setFocusedApparatus(null);
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    },
    [focusedApparatus, setFocusedApparatus],
  );

  if (focusedApparatus !== "burette" || !stage) return null;

  const interactive = canWrite && !pending;
  const stopcockOpen = stopcockOpenForStage === activeStageKey;
  const reading = stage.burette.readingMl;
  const canRecordReading =
    interactive && reading !== null && stage.openTrial === null && stage.nextTrialNumber === null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="focus-mode-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={() => setFocusedApparatus(null)}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="focus-mode-title" className="text-sm font-semibold">
              Burette — {stage.burette.capacityMl} mL, graduated to {stage.burette.graduationMl} mL
            </h2>
            <p className="text-xs text-muted">{stage.title}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setFocusedApparatus(null)}
            aria-label="Close burette focus mode"
          >
            <X aria-hidden="true" className="size-4" />
            Close
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
          {/* Large drawing of the burette */}
          <div className="flex items-center justify-center border border-line rounded-md bg-surface-muted p-3">
            <svg viewBox="-60 -5 270 470" role="img" aria-label="Burette scale, enlarged" className="max-h-[52vh] w-auto">
              <BuretteSvg
                view={stage.burette}
                opened={stopcockOpen}
                selected
                interactive={interactive}
                onToggleStopcock={() => toggleStopcock(activeStageKey)}
              />
            </svg>
          </div>

          {/* Reading aid and the reading-bound actions */}
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-line px-3 py-2">
              <p className="text-xs font-medium text-muted">Meniscus</p>
              <p className="text-2xl font-semibold tabular-nums">
                {reading === null ? "—" : `${reading.toFixed(2)} mL`}
              </p>
              <p className="mt-1 text-xs text-muted">
                {reading === null
                  ? "The burette has not been filled yet. Fill it below and record the initial reading."
                  : "Read the bottom of the curve against the scale and record YOUR value. The drawing is illustrative — the engine checks the number you type against the volume it actually delivered."}
              </p>
            </div>

            {stage.openTrial !== null && stage.openTrial.finalReadingMl === null ? (
              <ReadingSection />
            ) : !stage.burette.setup ? (
              <BuretteSetupSection initialState={initialState} />
            ) : stage.openTrial === null && stage.nextTrialNumber !== null ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">
                  The burette is filled. Start the next titration and record its initial reading.
                </p>
                <StartTrialControl stageKey={activeStageKey} trialNumber={stage.nextTrialNumber} />
              </div>
            ) : (
              <p className="rounded-md border border-line px-3 py-2 text-sm text-muted">
                Stopcock:{" "}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!interactive}
                  onClick={() => toggleStopcock(activeStageKey)}
                >
                  {stopcockOpen ? "Close it" : "Open it"}
                </Button>
                {canRecordReading ? null : " — trials in progress."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}