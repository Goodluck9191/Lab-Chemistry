"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useActiveStage, useLabServer } from "./lab-state-provider";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * Observation panel.
 *
 * The prompts come from the experiment's declared observation fields (the only
 * place they exist), and the text is saved through the ordinary protocol action
 * `record_observation`. The textarea is therefore a draft: what is authoritative
 * is what the server stored, which is what the panel shows once the write lands.
 * Local React state is never the source of truth — if the save fails, the draft
 * is kept but flagged, and the panel still shows the last stored value.
 */
export function ObservationPanel({ initialState }: { initialState: LabStateView }) {
  const stage = useActiveStage();
  const { state, perform, pending, canWrite } = useLabServer();
  // Drafts are keyed by stage AND field, so switching stage never shows one
  // stage's text in another's box. A draft with no entry falls back to the value
  // the server stored — which is why an untouched field is never "dirty".
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const stored = state.publicState.observations ?? [];

  if (!stage) return null;

  const savedTextFor = (fieldKey: string): string =>
    stored.find(
      (observation) => observation.stageKey === stage.key && observation.fieldKey === fieldKey,
    )?.textValue ?? "";

  const endpointColours = stage.trials
    .filter((trial) => trial.observedColour !== null)
    .map((trial) => ({ trial: trial.trialNumber, colour: trial.observedColour }));

  return (
    <section aria-label="Observations" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Observations</h3>
        <p className="text-xs text-muted">
          Saved on this stage as you record them.
        </p>
      </div>

      {initialState.declaredObservations.length === 0 ? (
        <Alert tone="info">
          This experiment declares no written observation fields, so there is nothing to record here.
        </Alert>
      ) : null}

      {initialState.declaredObservations.map((field) => {
        const draftKey = `${stage.key}:${field.fieldKey}`;
        const savedValue = savedTextFor(field.fieldKey);
        const draft = drafts[draftKey] ?? savedValue;
        const dirty = draft.trim() !== savedValue.trim();
        return (
          <div key={field.fieldKey} className="flex flex-col gap-1.5">
            <label htmlFor={`observation-${draftKey}`} className="text-sm font-medium">
              {field.prompt}
              {field.isRequired ? <span className="ml-1 text-xs text-muted">(required)</span> : null}
            </label>
            <Textarea
              id={`observation-${draftKey}`}
              value={draft}
              disabled={!canWrite || pending}
              maxLength={2000}
              aria-describedby={`observation-${draftKey}-state`}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [draftKey]: event.target.value }))
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!canWrite || pending || draft.trim().length === 0 || !dirty}
                onClick={() =>
                  void perform({
                    type: "record_observation",
                    stageKey: stage.key,
                    fieldKey: field.fieldKey,
                    text: draft.trim(),
                  })
                }
              >
                {savedValue ? "Update observation" : "Save observation"}
              </Button>
              <span id={`observation-${draftKey}-state`} className="flex items-center gap-2">
                {savedValue ? (
                  <Badge tone="success">Saved</Badge>
                ) : (
                  <Badge tone="neutral">Not saved</Badge>
                )}
                {dirty ? <span className="text-xs text-muted">Unsaved changes</span> : null}
              </span>
            </div>
            {savedValue ? (
              <p className="text-xs text-muted">
                Stored: <span className="text-foreground">{savedValue}</span>
              </p>
            ) : null}
          </div>
        );
      })}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Endpoint colours recorded by the simulation
        </h4>
        {endpointColours.length === 0 ? (
          <p className="mt-1 text-xs text-muted">
            No trial has reached a colour observation yet.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-xs">
            {endpointColours.map((entry) => (
              <li key={entry.trial}>
                Trial {entry.trial}: <span className="font-medium">{entry.colour?.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
