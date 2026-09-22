"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi, useLabViewModel } from "../../lab-state-provider";
import { Lab3DConcordanceStrip } from "../Lab3DActions";
import { stopcockNotchFor } from "../simulation/stopcock";
import { carryingLabel } from "../interactions/carry";
import { rotationLabel } from "../simulation/keymap";

/**
 * The minimal HUD (§5).
 *
 * Four edges and nothing else: where you are on the left, what to do next in
 * the middle, the state of the attempt on the right, and what your hands are
 * doing along the bottom. There is deliberately no permanent toolbar, no
 * sidebar and no dashboard panel — the laboratory stays visually dominant, and
 * anything that can be done to a piece of apparatus is offered by the
 * contextual prompt instead of by a button that is always on screen.
 *
 * The two button groups are distinguished on purpose: INTERACT opens the
 * contextual prompt for what you are looking at, while Procedure / Actions /
 * Results open the full text surfaces, which remain the accessible path to
 * every step.
 */

export function LabHud({
  experimentNumber,
  partLabel,
  onProcedure,
  onActions,
  onResults,
  drawer,
}: {
  experimentNumber: number;
  partLabel: string;
  onProcedure: () => void;
  onActions: () => void;
  onResults: () => void;
  drawer: "procedure" | "actions" | "results" | null;
}) {
  const stage = useActiveStage();
  const model = useLabViewModel();
  const { saveStatus } = useLabServer();
  const {
    walkMode,
    setWalkMode,
    carried,
    carriedRotation,
    promptOpen,
    setPromptOpen,
    activeStageKey,
    stopcockAngleForStage,
  } = useLabUi();

  const valve = stopcockNotchFor(stopcockAngleForStage(activeStageKey));

  return (
    <>
      {/* Top edge: where we are, what next, and the state of the attempt. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto max-w-[30%] rounded-md bg-surface/90 px-2 py-1.5 shadow backdrop-blur">
          <p className="text-xs font-semibold leading-tight">Experiment {experimentNumber}</p>
          <p className="text-[11px] leading-tight text-muted">{partLabel}</p>
        </div>

        <div
          className="pointer-events-auto max-w-[32%] rounded-md bg-surface/90 px-2 py-1.5 text-center shadow backdrop-blur"
          role="status"
          aria-label="Current objective"
        >
          <p className="text-[11px] font-medium leading-tight">
            {stage?.nextAction ? `Next: ${stage.nextAction.title}` : "Review your results"}
          </p>
        </div>

        <div className="pointer-events-auto flex max-w-[38%] flex-wrap items-center justify-end gap-1.5 rounded-md bg-surface/90 px-2 py-1.5 shadow backdrop-blur">
          <span className="text-[11px] text-muted" role="status">
            {saveStatus === "saving" ? "Saving…" : saveStatus === "failed" ? "Save failed" : "Autosaved"}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setWalkMode(!walkMode)}
            aria-pressed={walkMode}
            title={
              walkMode
                ? "First-person walking with the pointer captured. Switch to free orbit to look around the bench."
                : "Free orbit. Switch to walk the laboratory in first person."
            }
          >
            {walkMode ? "Walk" : "Orbit"}
          </Button>
          <Button
            size="sm"
            variant={promptOpen ? "primary" : "secondary"}
            onClick={() => setPromptOpen(!promptOpen)}
            aria-expanded={promptOpen}
          >
            Interact
          </Button>
          <Button size="sm" variant="secondary" onClick={onProcedure} aria-expanded={drawer === "procedure"}>
            Procedure
          </Button>
          <Button size="sm" variant="secondary" onClick={onActions} aria-expanded={drawer === "actions"}>
            Actions
          </Button>
          <Button size="sm" variant="secondary" onClick={onResults} aria-expanded={drawer === "results"}>
            Results
          </Button>
          <Link
            href="/student/experiments"
            className="text-[11px] text-muted underline-offset-2 hover:underline"
          >
            Exit lab
          </Link>
        </div>
      </div>

      {/* Under the top edge: the attempt's trial record, straight from the
          server-computed concordance. */}
      <div className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center px-3 sm:top-16">
        <div className="pointer-events-auto rounded-md bg-surface/85 px-2 py-1 shadow backdrop-blur">
          <Lab3DConcordanceStrip />
        </div>
      </div>

      {/* Bottom edge: what your hands are doing, and the controls. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto max-w-[55%] rounded-md bg-surface/90 px-2 py-1.5 text-[11px] text-muted shadow backdrop-blur">
          {/* The instrument readings in text, so nothing depends on reading
              glass in a picture: the stored meniscus and the flask colour are
              both named here as well as drawn. */}
          {stage?.burette.readingMl !== null && stage?.burette.readingMl !== undefined ? (
            <span className="me-1.5 font-medium text-foreground">
              Burette: {stage.burette.readingMl.toFixed(2)} mL
            </span>
          ) : null}
          {stage?.flask.hasContents ? (
            <span className="me-1.5 font-medium text-foreground">Flask: {stage.flask.label}</span>
          ) : null}
          <span className="font-medium text-foreground">{model.progress.label}</span>
          <span className="mx-1.5">·</span>
          WASD walk · mouse look · <span className="font-medium">E</span> interact ·{" "}
          <span className="font-medium">F</span> inspect · <span className="font-medium">R</span> rotate ·{" "}
          <span className="font-medium">Space</span> set down · <span className="font-medium">Esc</span> release
        </div>
        <div className="flex flex-col items-end gap-1">
          {carried ? (
            <div
              className="pointer-events-auto rounded-md bg-surface/90 px-2 py-1.5 text-[11px] shadow backdrop-blur"
              role="status"
              aria-label="Holding"
            >
              Holding: <span className="font-medium">{carryingLabel(carried)}</span>
              <span className="ms-2 text-muted">turned {rotationLabel(carriedRotation)}</span>
            </div>
          ) : null}
          {valve.flowMode !== null ? (
            <span className="pointer-events-auto rounded-md bg-surface/85 px-2 py-1 text-[11px] text-muted shadow backdrop-blur">
              Stopcock: {valve.label}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
