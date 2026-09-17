"use client";

import { Badge } from "@/components/ui/badge";
import { useActiveStage } from "./lab-state-provider";

/**
 * Concordance panel.
 *
 * Every number here was computed BY THE SERVER from the attempt's saved trials
 * (`projectStageConcordance`), using the same rule the assessment uses. The
 * component only formats and explains it — it never re-implements the rule, so
 * the screen and the grade can never disagree.
 *
 * The panel is equally explicit about the two things a student must understand:
 * which trials count, and whether more are still needed.
 */
export function ConcordancePanel() {
  const stage = useActiveStage();
  if (!stage) return null;
  const concordance = stage.concordance;

  const tone =
    concordance.status === "concordant"
      ? "success"
      : concordance.status === "not_concordant"
        ? "warning"
        : "neutral";

  const headline =
    concordance.status === "concordant"
      ? "Concordant"
      : concordance.status === "not_concordant"
        ? "Not concordant"
        : concordance.status === "insufficient_evidence"
          ? "More trials required"
          : "Not started";

  return (
    <section aria-label="Concordance" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Concordance</h3>
        <Badge tone={tone}>{headline}</Badge>
      </div>

      <p className="text-sm text-muted">{concordance.summary}</p>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Trials recorded</dt>
          <dd className="font-medium tabular-nums">
            {concordance.recordedTrials} / {concordance.requiredTrials} required
          </dd>
        </div>
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Trial limit</dt>
          <dd className="font-medium tabular-nums">{concordance.maxTrials}</dd>
        </div>
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Spread</dt>
          <dd className="font-medium tabular-nums">
            {concordance.spread === null
              ? "not available yet"
              : `${concordance.spread} ${concordance.spreadUnit}`}
          </dd>
        </div>
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Allowed spread</dt>
          <dd className="font-medium tabular-nums">
            {concordance.allowedSpread} {concordance.spreadUnit}
          </dd>
        </div>
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Accepted trials</dt>
          <dd className="font-medium tabular-nums">
            {concordance.acceptedTrialNumbers.length === 0
              ? "none"
              : concordance.acceptedTrialNumbers.join(", ")}
          </dd>
        </div>
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Rejected trials</dt>
          <dd className="font-medium tabular-nums">
            {concordance.discardedTrials.length === 0
              ? "none"
              : concordance.discardedTrials.join(", ")}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-muted">{concordance.detail}</p>

      {concordance.averageMolarityM !== null ? (
        <p className="text-xs text-muted">
          Average of the two closest reported values:{" "}
          <span className="font-medium tabular-nums">{concordance.averageMolarityM} mol/L</span>{" "}
          (from your own submissions).
        </p>
      ) : null}
    </section>
  );
}
