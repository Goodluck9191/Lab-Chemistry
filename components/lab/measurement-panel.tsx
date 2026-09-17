"use client";

import { Badge } from "@/components/ui/badge";
import { useActiveStage, useLabServer } from "./lab-state-provider";

/**
 * Measurements recorded on this stage.
 *
 * Every figure is read from the saved session state — the same numbers the
 * server wrote to the measurement rows on each accepted action. Nothing is
 * recalculated here: the titre shown is the value the engine derived from the
 * two readings, not a subtraction performed in the browser.
 *
 * A reading the server flagged (for example a meniscus read that does not match
 * the volume actually delivered) is listed as a flag on the attempt, described by
 * its code rather than by any raw detail string.
 */
export function MeasurementPanel() {
  const stage = useActiveStage();
  const { state } = useLabServer();
  if (!stage) return null;

  const events = state.publicState.errorEvents.filter(
    (event) => event.stageKey === stage.key || event.stageKey === null,
  );

  const rows: Array<{ label: string; value: string; note?: string }> = [];
  if (stage.portion.kind === "weighed_mass" && stage.portion.recordedMassG !== null) {
    rows.push({
      label: `Mass of ${stage.analyteKey} weighed`,
      value: `${stage.portion.recordedMassG} g`,
      note: `recorded to ±${stage.portion.precision} g`,
    });
  }
  if (stage.portion.kind === "pipetted_volume" && stage.portion.recordedVolumeMl !== null) {
    rows.push({
      label: `Aliquot of ${stage.analyteKey} pipetted`,
      value: `${stage.portion.recordedVolumeMl} mL`,
      note: `known to ${stage.portion.precision} mL`,
    });
  }
  if (stage.burette.readingMl !== null) {
    rows.push({
      label: "Burette filling (initial reading)",
      value: `${stage.burette.readingMl.toFixed(2)} mL`,
    });
  }
  if (stage.indicator.dropsAdded !== null) {
    rows.push({ label: `${stage.indicator.name} added`, value: `${stage.indicator.dropsAdded} drops` });
  }
  for (const trial of [...stage.trials, ...(stage.openTrial ? [stage.openTrial] : [])].sort(
    (a, b) => a.trialNumber - b.trialNumber,
  )) {
    if (trial.initialReadingMl !== null) {
      rows.push({
        label: `Trial ${trial.trialNumber}: initial reading`,
        value: `${trial.initialReadingMl.toFixed(2)} mL`,
      });
    }
    if (trial.finalReadingMl !== null) {
      rows.push({
        label: `Trial ${trial.trialNumber}: final reading`,
        value: `${trial.finalReadingMl.toFixed(2)} mL`,
      });
    }
    if (trial.titreMl !== null) {
      rows.push({
        label: `Trial ${trial.trialNumber}: volume used`,
        value: `${trial.titreMl.toFixed(2)} mL`,
        note: "derived by the simulation from the two readings",
      });
    }
    if (trial.reportedMolarityM !== null) {
      rows.push({
        label: `Trial ${trial.trialNumber}: reported concentration`,
        value: `${trial.reportedMolarityM} mol/L`,
      });
    }
  }

  return (
    <section aria-label="Measurements" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Measurements</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">
          Nothing has been recorded on this stage yet. Readings appear here as soon as the server
          saves them.
        </p>
      ) : (
        <dl className="flex flex-col gap-1 text-xs">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-b-0"
            >
              <dt className="text-muted">
                {row.label}
                {row.note ? <span className="ml-1 opacity-80">({row.note})</span> : null}
              </dt>
              <dd className="shrink-0 font-medium tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Technique flags on this attempt
        </h4>
        {events.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No flags recorded.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {events.map((event, index) => (
              <li key={`${event.code}-${event.trialNumber ?? "stage"}-${index}`}>
                <Badge tone={event.severe ? "danger" : "warning"}>
                  {event.code.replace(/_/g, " ")}
                  {event.trialNumber === null ? "" : ` · trial ${event.trialNumber}`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted">
          Flags are recorded by the simulation. They are shown by code, because the underlying
          explanation compares your work with hidden experimental values.
        </p>
      </div>
    </section>
  );
}
