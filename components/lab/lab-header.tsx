"use client";

import Link from "next/link";
import { ArrowLeft, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutosaveIndicator } from "./autosave-indicator";
import { useLabServer, useLabUi, useLabViewModel } from "./lab-state-provider";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * Compact sticky laboratory top bar.
 *
 * One row: experiment identity + stage switch on the left, trial progress in
 * the middle, autosave status + reload + exit on the right. Everything shown
 * is public: no score, no hidden concentration, no endpoint.
 */
export function LabHeader({ initialState }: { initialState: LabStateView }) {
  const { pending, refresh } = useLabServer();
  const { activeStageKey, setActiveStageKey } = useLabUi();
  const model = useLabViewModel();
  const activeStage = model.stages.find((stage) => stage.key === activeStageKey) ?? model.stages[0];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[110rem] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-4">
        <Link
          href={`/lab/${initialState.experimentId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
          aria-label="Exit to experiment briefing"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Experiment {initialState.experimentNumber}</span>
          <span className="sm:hidden">Exp {initialState.experimentNumber}</span>
        </Link>

        <div className="min-w-0 flex-1 basis-48">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            {initialState.experimentTitle}
          </h1>
          <p className="truncate text-xs text-muted">
            {activeStage ? (
              <>
                Stage {String.fromCharCode(65 + activeStage.index)} — {activeStage.title}
                {" · "}
                {model.progress.label}
              </>
            ) : (
              "No stage configured"
            )}
          </p>
        </div>

        <div
          className="hidden items-center gap-1 md:flex"
          role="group"
          aria-label="Experiment stages"
        >
          {model.stages.map((stage) => (
            <button
              key={stage.key}
              type="button"
              aria-pressed={stage.key === activeStageKey}
              onClick={() => setActiveStageKey(stage.key)}
              className={
                "rounded-md border px-2.5 py-1 text-xs font-medium " +
                (stage.key === activeStageKey
                  ? "border-primary text-primary"
                  : "border-line text-muted hover:bg-surface-muted")
              }
            >
              Stage {String.fromCharCode(65 + stage.index)}
              {stage.complete ? " ✓" : ""}
            </button>
          ))}
        </div>

        <div
          className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-surface-muted lg:block"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={model.progress.percent}
          aria-label="Trials recorded"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${model.progress.percent}%` }}
          />
        </div>

        <AutosaveIndicator className="hidden xl:flex" />

        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          disabled={pending}
          aria-label="Reload the saved state from the server"
        >
          <RotateCw aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Reload</span>
        </Button>
      </div>
    </header>
  );
}
