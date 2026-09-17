"use client";

import { Badge } from "@/components/ui/badge";
import { useActiveStage } from "./lab-state-provider";
import type { TrialRowView } from "./view-model";

/**
 * Titration results table.
 *
 * Every row is a trial that exists in the saved session — including a trial that
 * is still open, and including one the engine discarded for overshooting. There
 * are no placeholder rows: a student who has run nothing sees an empty table
 * with the reason, not a table full of dashes pretending to be data.
 *
 * The Observation column shows what the flask actually showed when the trial was
 * closed (or the engine's rejection reason), so the record explains itself.
 */
export function TrialTable() {
  const stage = useActiveStage();
  if (!stage) return null;

  const rows: TrialRowView[] = [
    ...stage.trials,
    ...(stage.openTrial ? [stage.openTrial] : []),
  ].sort((a, b) => a.trialNumber - b.trialNumber);

  const anyReported = rows.some((row) => row.reportedMolarityM !== null);

  return (
    <section aria-label="Titration results" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Titration results</h3>
        <p className="text-xs text-muted">
          {rows.length === 0
            ? `No trials yet. The experiment asks for ${stage.concordance.requiredTrials} concordant titres.`
            : `${stage.concordance.recordedTrials} recorded · ${stage.concordance.discardedTrials.length} rejected`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">
            Titration trials with readings, observed colour and status
          </caption>
          <thead>
            <tr className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-3 py-2">Trial</th>
              <th scope="col" className="px-3 py-2">Initial reading</th>
              <th scope="col" className="px-3 py-2">Final reading</th>
              <th scope="col" className="px-3 py-2">Volume used</th>
              <th scope="col" className="px-3 py-2">Observation</th>
              {anyReported ? <th scope="col" className="px-3 py-2">Reported c</th> : null}
              <th scope="col" className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-muted" colSpan={anyReported ? 7 : 6}>
                  No trials have been recorded on this stage yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.trialNumber} className="border-t border-line">
                  <th scope="row" className="px-3 py-2 text-left font-medium tabular-nums">
                    {row.trialNumber}
                  </th>
                  <td className="px-3 py-2 tabular-nums">
                    {row.initialReadingMl === null ? "—" : `${row.initialReadingMl.toFixed(2)} mL`}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.finalReadingMl === null ? "—" : `${row.finalReadingMl.toFixed(2)} mL`}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.titreMl === null ? "—" : `${row.titreMl.toFixed(2)} mL`}
                  </td>
                  <td className="px-3 py-2">{row.observationLabel}</td>
                  {anyReported ? (
                    <td className="px-3 py-2 tabular-nums">
                      {row.reportedMolarityM === null
                        ? "—"
                        : `${row.reportedMolarityM} mol/L`}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {stage.concordance.discardedTrials.length > 0 ? (
        <p className="text-xs text-muted">
          Rejected trials stay in the table as a record: the laboratory requires the flask to be
          discarded and the titration repeated.
        </p>
      ) : null}
    </section>
  );
}
