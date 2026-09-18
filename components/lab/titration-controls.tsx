"use client";

import { useId, useState } from "react";
import { Droplets, Eye, Pause, Play, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveStage, useLabServer, useLabUi } from "./lab-state-provider";
import { ControlReason, describedBy } from "./control-reason";
import {
  completionAvailability,
  deliveryAvailability,
  discardAvailability,
  observationAvailability,
  readingAvailability,
  startTrialAvailability,
  stopcockAvailability,
  swirlAvailability,
} from "./control-availability";
import { ReadingInput, readingIsUsable } from "./reading-input";
import type { FlaskColour } from "@/domain/simulation/titration/endpoint";

/**
 * Titration controls.
 *
 * The increments are DERIVED FROM THE CONFIGURATION's graduation (ten
 * graduations for a fast delivery, one for a slow one, half a graduation
 * dropwise), which is what makes "slow down near the endpoint" a real decision:
 * a large increment past the colour change is an overshoot the engine will
 * reject at the end of the trial.
 *
 * Nothing here predicts the endpoint. The flask colour shown next to these
 * controls comes from the server's public state, so a student learns the colour
 * only by delivering titrant and observing.
 *
 * A control that cannot be used is explained rather than merely dimmed: the
 * reason comes from `control-availability`, whose rules are pinned to the
 * engine's own refusals by a test.
 *
 * The sections are exported individually so the contextual instrument panel can
 * show the block for the selected apparatus; `TitrationControls` assembles them
 * all for the full titration view.
 */
export function TitrationControls() {
  const stage = useActiveStage();
  const { canWrite } = useLabServer();

  if (!stage) return null;

  const openTrial = stage.openTrial;

  return (
    <section aria-label="Titration controls" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Titrate</h3>
      <DeliverySection />
      {openTrial ? (
        <>
          <ObserveSection />
          <ReadingSection />
        </>
      ) : null}
      {!openTrial && canWrite && stage.nextTrialNumber !== null ? (
        <div className="rounded-md border border-line px-3 py-3">
          <p className="text-sm font-medium">Start trial {stage.nextTrialNumber}</p>
          <p className="mt-1 text-xs text-muted">
            Confirm the initial burette reading for the next titration. If you refilled the burette,
            record its new starting value.
          </p>
          <StartTrialControl stageKey={stage.key} trialNumber={stage.nextTrialNumber} />
        </div>
      ) : null}
      <DiscardSection />
    </section>
  );
}

/**
 * Discard the completed trial's solution into the waste container. The next
 * trial cannot start until this runs, so the disposal the manual requires is
 * an action, not a silent reset.
 */
export function DiscardSection() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const uid = useId();
  const reasonId = `${uid}-discard-reason`;

  if (!stage || stage.trials.length === 0 || stage.preparationState.lastTrialDiscarded) {
    return null;
  }

  const availability = discardAvailability(stage, { canWrite, pending });

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="text-sm font-medium">Discard into the waste container</p>
      <p className="mt-1 text-xs text-muted">
        Pour the flask contents into waste so the next trial starts with a clean flask.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!availability.available}
          aria-describedby={describedBy(reasonId, availability)}
          onClick={() => void perform({ type: "discard_to_waste", stageKey: stage.key })}
        >
          Discard into waste
        </Button>
      </div>
      <ControlReason id={reasonId} reason={availability.reason} className="mt-1" />
    </div>
  );
}

export function DeliverySection() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { activeStageKey, stopcockOpenForStage, toggleStopcock, swirl, setSwirl } = useLabUi();
  const uid = useId();
  const stopcockReasonId = `${uid}-stopcock-reason`;
  const deliveryReasonId = `${uid}-delivery-reason`;
  const swirlReasonId = `${uid}-swirl-reason`;

  if (!stage) return null;

  const stopcockOpen = stopcockOpenForStage === activeStageKey;
  const openTrial = stage.openTrial;
  const graduationMl = stage.burette.graduationMl;
  const flags = { canWrite, pending, stopcockOpen };
  const stopcock = stopcockAvailability(stage, flags);
  const delivery = deliveryAvailability(stage, flags);
  const swirling = swirlAvailability(stage, flags);

  const increments: Array<{ label: string; volumeMl: number; describe: string }> = [
    { label: `${(graduationMl * 10).toFixed(2)} mL`, volumeMl: graduationMl * 10, describe: "run in quickly" },
    { label: `${graduationMl.toFixed(2)} mL`, volumeMl: graduationMl, describe: "slow, near the endpoint" },
    { label: `${(graduationMl / 2).toFixed(2)} mL`, volumeMl: graduationMl / 2, describe: "dropwise" },
  ];

  const flaskColour = stage.flask.colour;
  const overshootWarning = flaskColour === "pink" || flaskColour === "deep_pink";

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Stopcock</p>
        <Button
          size="sm"
          variant={stopcockOpen ? "primary" : "secondary"}
          aria-pressed={stopcockOpen}
          disabled={!stopcock.available}
          aria-describedby={describedBy(stopcockReasonId, stopcock)}
          onClick={() => toggleStopcock(activeStageKey)}
        >
          {stopcockOpen ? (
            <>
              <Pause aria-hidden="true" className="size-4" /> Close stopcock
            </>
          ) : (
            <>
              <Play aria-hidden="true" className="size-4" /> Open stopcock
            </>
          )}
        </Button>
        <ControlReason id={stopcockReasonId} reason={stopcock.reason} className="w-full" />
      </div>

      <div className="mt-3">
        <p className="text-xs text-muted">
          Deliver titrant while the stopcock is open. Each delivery is saved immediately and the
          flask is observed again.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {increments.map((increment) => (
            <Button
              key={increment.label}
              size="sm"
              variant="secondary"
              disabled={!delivery.available}
              aria-describedby={describedBy(deliveryReasonId, delivery)}
              title={increment.describe}
              onClick={() =>
                void perform({
                  type: "add_titrant",
                  stageKey: activeStageKey,
                  volumeMl: increment.volumeMl,
                })
              }
            >
              <Droplets aria-hidden="true" className="size-4" />
              {increment.label}
            </Button>
          ))}
        </div>
        <ControlReason id={deliveryReasonId} reason={delivery.reason} className="mt-1" />
        {delivery.available ? (
          <p className="mt-1 text-xs text-muted">Stopcock open: titrant is running.</p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={swirl ? "primary" : "secondary"}
          aria-pressed={swirl}
          // Swirling records nothing, but on a closed attempt the whole bench is
          // inert, so it is explained rather than silently unavailable.
          disabled={!swirling.available}
          aria-describedby={describedBy(swirlReasonId, swirling)}
          onClick={() => setSwirl((current) => !current)}
        >
          <RotateCw aria-hidden="true" className="size-4" />
          {swirl ? "Stop swirling" : "Swirl the flask"}
        </Button>
        <span className="text-xs text-muted" aria-live="polite">
          {swirl ? "Flask swirling." : "Flask at rest."}
        </span>
        <ControlReason id={swirlReasonId} reason={swirling.reason} className="w-full" />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Delivered this trial</dt>
          <dd className="font-medium tabular-nums">{stage.deliveredMl.toFixed(2)} mL</dd>
        </div>
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Trial</dt>
          <dd className="font-medium tabular-nums">
            {openTrial ? `trial ${openTrial.trialNumber}` : "none open"}
          </dd>
        </div>
        <div className="rounded border border-line px-2 py-1.5">
          <dt className="text-muted">Flask</dt>
          <dd className="font-medium">{stage.flask.label}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">{stage.flask.description}</p>
      {overshootWarning ? (
        <p className="mt-2 text-xs text-warning" role="status">
          The colour has gone past the faint pink of the endpoint. If the trial is completed now
          the laboratory will reject it and require a repeat.
        </p>
      ) : null}
    </div>
  );
}

export function ObserveSection() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { activeStageKey, stopcockOpenForStage } = useLabUi();
  const [claimedColour, setClaimedColour] = useState<FlaskColour>("faint_pink");
  const uid = useId();
  const reasonId = `${uid}-observe-reason`;

  if (!stage) return null;

  const blocked = !canWrite || pending;
  const observation = observationAvailability(stage, {
    canWrite,
    pending,
    stopcockOpen: stopcockOpenForStage === activeStageKey,
  });

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Eye aria-hidden="true" className="size-4 text-muted" />
        Record what you observe
      </p>
      <p className="mt-1 text-xs text-muted">
        The faint pink of the endpoint must persist {stage.indicator.persistenceSeconds[0]} to{" "}
        {stage.indicator.persistenceSeconds[1]} seconds before you record it. Judge the colour
        yourself; the laboratory does not tell you the endpoint.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["colourless", "faint_pink", "pink", "deep_pink"] as const).map((colour) => (
          <Button
            key={colour}
            size="sm"
            variant={claimedColour === colour ? "primary" : "secondary"}
            aria-pressed={claimedColour === colour}
            disabled={blocked}
            onClick={() => setClaimedColour(colour)}
          >
            {colour.replace(/_/g, " ")}
          </Button>
        ))}
      </div>
      <Button
        size="sm"
        className="mt-2"
        disabled={!observation.available}
        aria-describedby={describedBy(reasonId, observation)}
        onClick={() =>
          void perform({
            type: "observe_endpoint",
            stageKey: activeStageKey,
            claimedColour,
          })
        }
      >
        Record observation
      </Button>
      <ControlReason id={reasonId} reason={observation.reason} className="mt-1" />
    </div>
  );
}

export function ReadingSection() {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { activeStageKey, stopcockOpenForStage } = useLabUi();
  const [finalReading, setFinalReading] = useState("");
  const uid = useId();
  const readingReasonId = `${uid}-reading-reason`;
  const completionReasonId = `${uid}-completion-reason`;

  if (!stage) return null;

  const openTrial = stage.openTrial;
  if (!openTrial) return null;

  const flags = {
    canWrite,
    pending,
    stopcockOpen: stopcockOpenForStage === activeStageKey,
  };
  const reading = readingAvailability(stage, flags);
  const completion = completionAvailability(stage, flags);

  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="text-sm font-medium">Read the burette and close the trial</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <ReadingInput
          id={`final-${activeStageKey}`}
          label="Final burette reading"
          kind="burette"
          value={finalReading}
          onChange={setFinalReading}
          disabled={!canWrite || pending}
          hint={`Read the bottom of the meniscus against the scale, to ${stage.burette.readingPrecisionMl} mL.`}
          className="w-48"
        />
        <Button
          size="sm"
          disabled={!reading.available || !readingIsUsable(finalReading, "burette")}
          aria-describedby={describedBy(readingReasonId, reading)}
          onClick={async () => {
            await perform({
              type: "read_burette",
              stageKey: activeStageKey,
              observedFinalMl: Number(finalReading),
            });
            setFinalReading("");
          }}
        >
          Record final reading
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!completion.available}
          aria-describedby={describedBy(completionReasonId, completion)}
          onClick={() => void perform({ type: "complete_trial", stageKey: activeStageKey })}
        >
          Complete trial
        </Button>
        <ControlReason id={readingReasonId} reason={reading.reason} className="w-full" />
        <ControlReason id={completionReasonId} reason={completion.reason} className="w-full" />
      </div>
      {openTrial.finalReadingMl === null ? null : (
        <p className="mt-2 text-xs text-muted">
          Recorded: initial {openTrial.initialReadingMl?.toFixed(2)} mL, final{" "}
          {openTrial.finalReadingMl.toFixed(2)} mL, titre{" "}
          {openTrial.titreMl?.toFixed(2) ?? "—"} mL.
        </p>
      )}
    </div>
  );
}

export function StartTrialControl({
  stageKey,
  trialNumber,
}: {
  stageKey: string;
  trialNumber: number;
}) {
  const stage = useActiveStage();
  const { perform, pending, canWrite } = useLabServer();
  const { activeStageKey, stopcockOpenForStage } = useLabUi();
  const [reading, setReading] = useState("");
  const uid = useId();
  const reasonId = `${uid}-start-trial-reason`;

  if (!stage) return null;

  // The engine decides whether a trial may begin, so the reason is derived from
  // the same state the engine will read rather than assumed by this control.
  const availability = startTrialAvailability(stage, {
    canWrite,
    pending,
    stopcockOpen: stopcockOpenForStage === activeStageKey,
  });

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-3">
        <ReadingInput
          id={`start-${stageKey}-${trialNumber}`}
          label="Initial burette reading"
          kind="burette"
          value={reading}
          onChange={setReading}
          disabled={!canWrite || pending}
          aria-describedby={describedBy(reasonId, availability)}
          className="w-48"
        />
        <Button
          size="sm"
          disabled={!availability.available || !readingIsUsable(reading, "burette")}
          aria-describedby={describedBy(reasonId, availability)}
          onClick={async () => {
            await perform({
              type: "start_trial",
              stageKey,
              trialNumber,
              initialReadingMl: Number(reading),
            });
            setReading("");
          }}
        >
          Start trial {trialNumber}
        </Button>
      </div>
      <ControlReason id={reasonId} reason={availability.reason} className="mt-1" />
    </div>
  );
}
