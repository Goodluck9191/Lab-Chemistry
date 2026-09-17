"use client";

import { useCallback, useRef, useState } from "react";
import { FlaskConical, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LabStateView } from "@/application/attempts/lab-state";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import { LabWorkspace } from "../lab-workspace";
import { loadPreviewScenario, replayPreviewLabAction } from "./preview-actions";

/**
 * The development preview.
 *
 * It renders the SAME `LabWorkspace` the real laboratory does, driven by the same
 * action controller — only the transport differs: an action is replayed
 * server-side against the scenario instead of being persisted against an attempt.
 *
 * The client therefore holds nothing but the student's own accepted actions. There
 * is no simulation state here, no hidden value, and nothing is saved: reloading
 * returns the bench to its seed.
 */

export interface PreviewScenarioOption {
  id: string;
  title: string;
  description: string;
}

export function PreviewCanvas({
  scenarios,
  initialScenarioId,
  initialState,
}: {
  scenarios: PreviewScenarioOption[];
  initialScenarioId: string;
  initialState: LabStateView;
}) {
  const [scenarioId, setScenarioId] = useState(initialScenarioId);
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<TitrationProtocolAction[]>([]);

  /**
   * The only difference from the real laboratory: the action is replayed against
   * the scenario on the server rather than written to an attempt. The controller
   * sees the same `LabActionOutcome`, so refusals, conflicts and save states all
   * behave identically.
   */
  const send = useCallback(
    async (input: unknown): Promise<LabActionOutcome> => {
      const action = (input as { action?: TitrationProtocolAction }).action;
      const outcome = await replayPreviewLabAction({
        scenarioId,
        history: historyRef.current,
        envelope: input,
      });

      if (outcome.status === "ok" && outcome.accepted && action) {
        // Only accepted actions are remembered, which is what keeps the replay
        // and the server's revision in step.
        historyRef.current = [...historyRef.current, action];
      } else if (outcome.status === "conflict") {
        historyRef.current = [];
      }
      return outcome;
    },
    [scenarioId],
  );

  const load = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const next = await loadPreviewScenario(id);
      if (!next) return;
      // Rebuilding from the seed is what "reset" means here: nothing was stored,
      // so there is nothing to undo.
      historyRef.current = [];
      setScenarioId(id);
      setState(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const active = scenarios.find((scenario) => scenario.id === scenarioId);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {/* Kept to two compact rows on purpose: the bench below is the point, and a
          tall harness header would squeeze it out of the viewport. */}
      <header className="border-b border-line bg-surface-muted px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical aria-hidden="true" className="size-4 text-primary" />
            Laboratory preview
          </p>
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs text-warning">
            development only
          </span>
          <p
            className="text-xs text-muted"
            title="The real titration engine, the real action protocol and the real bench — driven by scripted scenarios instead of a database. Nothing here is saved, no attempt is touched, and no hidden value is sent to the browser."
          >
            real engine · no database · nothing saved
            {active ? ` · ${active.description}` : ""}
          </p>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {scenarios.map((scenario) => {
            const selected = scenario.id === scenarioId;
            return (
              <Button
                key={scenario.id}
                size="sm"
                variant={selected ? "primary" : "secondary"}
                aria-pressed={selected}
                disabled={busy}
                onClick={() => void load(scenario.id)}
              >
                {scenario.title}
              </Button>
            );
          })}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void load(scenarioId)}
            aria-label="Rebuild this scenario from its seed"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <RotateCcw aria-hidden="true" className="size-4" />
            )}
            Reset
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Remounted per scenario: a fresh provider for a fresh attempt. */}
        <LabWorkspace
          key={scenarioId}
          initialState={state}
          send={send}
          heightClassName="h-full"
        />
      </div>
    </div>
  );
}
