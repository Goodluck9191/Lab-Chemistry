import { describe, expect, it } from "vitest";
import {
  CONTROL_REASONS,
  analytePortionAvailability,
  buretteSetupAvailability,
  completionAvailability,
  deliveryAvailability,
  focusModeAvailability,
  indicatorAvailability,
  observationAvailability,
  readingAvailability,
  selectionAvailability,
  startTrialAvailability,
  stopcockAvailability,
  swirlAvailability,
  type ControlAvailability,
  type LabControlFlags,
} from "@/components/lab/control-availability";
import { buildLabViewModel, type StageView } from "@/components/lab/view-model";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  addIndicator,
  addTitrant,
  completeTrial,
  observeEndpoint,
  readBurette,
  startTrialAction,
  weighAnalyte,
  type ActionResult,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import {
  STAGE_A,
  freshSession,
  prepareStageA,
  publicStateOf,
  runTrial,
  setup,
} from "../helpers/titration-fixtures";

/**
 * Every reason the laboratory shows a student must describe a rule the ENGINE
 * actually enforces. This suite holds the two together: for each reason, it puts
 * the session in the state the reason describes, checks the control is reported
 * unavailable with that exact wording, and then asks the domain itself — which
 * must refuse the action behind the control.
 *
 * That is the guard against UI drift: a hint cannot outlive the rule it
 * explains, because deleting the rule turns this test red.
 */

const config = publicTitrationConfigView(exp02TitrationConfig);

const OPEN_BENCH: LabControlFlags = { canWrite: true, pending: false, stopcockOpen: true };
const CLOSED_STOPCOCK: LabControlFlags = { canWrite: true, pending: false, stopcockOpen: false };

function stageViewFor(session: TitrationSession, stageKey: string = STAGE_A): StageView {
  const model = buildLabViewModel({
    config,
    publicState: publicStateOf(session),
    chemicalLabels: {},
    apparatusLabels: {},
    selectedStageKey: stageKey,
    canWrite: true,
  });
  const stage = model.stages.find((entry) => entry.key === stageKey);
  if (!stage) throw new Error(`no stage view for ${stageKey}`);
  return stage;
}

/** A stage sitting at the start of trial 1 with the burette ready. */
function readyToTitrate(): TitrationSession {
  const session = freshSession();
  setup(session);
  prepareStageA(session);
  startTrialAction(session, STAGE_A, 1, 0);
  return session;
}

/** A stage whose trials are exhausted, so no further trial may begin. */
function trialsExhausted(): TitrationSession {
  const session = freshSession();
  setup(session);
  prepareStageA(session);
  for (let trial = 1; trial <= config.trialRules.maxTrials; trial += 1) {
    runTrial(session, { trialNumber: trial, deliveredMl: 10 });
  }
  return session;
}

interface DriftCase {
  name: string;
  /** The rule the student is being told about. */
  reason: string;
  /** The engine's refusal code for the same state. */
  code: string;
  build: () => TitrationSession;
  availability: (stage: StageView, flags: LabControlFlags) => ControlAvailability;
  flags?: LabControlFlags;
  call: (session: TitrationSession) => ActionResult;
}

const DRIFT_CASES: DriftCase[] = [
  {
    name: "measuring the sample before the burette is set up",
    reason: CONTROL_REASONS.analyteNeedsBurette,
    code: "invalid_sequence",
    build: () => freshSession(),
    availability: analytePortionAvailability,
    call: (session) => weighAnalyte(session, STAGE_A, 0.6),
  },
  {
    name: "adding the indicator before the sample is ready",
    reason: CONTROL_REASONS.indicatorNeedsAnalyte,
    code: "invalid_sequence",
    build: () => {
      const session = freshSession();
      setup(session);
      return session;
    },
    availability: indicatorAvailability,
    call: (session) => addIndicator(session, STAGE_A, 3),
  },
  {
    name: "adding the indicator twice to the same solution",
    reason: CONTROL_REASONS.indicatorAlreadyAdded,
    code: "invalid_sequence",
    build: () => {
      const session = freshSession();
      setup(session);
      prepareStageA(session);
      return session;
    },
    availability: indicatorAvailability,
    call: (session) => addIndicator(session, STAGE_A, 3),
  },
  {
    name: "starting a trial before preparing the sample",
    reason: CONTROL_REASONS.startNeedsPreparation,
    code: "invalid_sequence",
    build: () => freshSession(),
    availability: startTrialAvailability,
    call: (session) => startTrialAction(session, STAGE_A, 1, 0),
  },
  {
    name: "starting a trial when the stage allows no more",
    reason: CONTROL_REASONS.noTrialsLeft,
    code: "invalid_sequence",
    build: trialsExhausted,
    availability: startTrialAvailability,
    call: (session) => startTrialAction(session, STAGE_A, config.trialRules.maxTrials + 1, 0),
  },
  {
    name: "delivering titrant with no trial running",
    reason: CONTROL_REASONS.deliveryNeedsTrial,
    code: "invalid_sequence",
    build: () => {
      const session = freshSession();
      setup(session);
      prepareStageA(session);
      return session;
    },
    availability: deliveryAvailability,
    call: (session) => addTitrant(session, STAGE_A, 1),
  },
  {
    name: "recording a burette reading with no trial running",
    reason: CONTROL_REASONS.readingNeedsTrial,
    code: "invalid_sequence",
    build: () => {
      const session = freshSession();
      setup(session);
      prepareStageA(session);
      return session;
    },
    availability: readingAvailability,
    call: (session) => readBurette(session, STAGE_A, 5),
  },
  {
    name: "closing a trial before the final reading exists",
    reason: CONTROL_REASONS.completionNeedsReading,
    code: "invalid_sequence",
    build: readyToTitrate,
    availability: completionAvailability,
    call: (session) => completeTrial(session, STAGE_A),
  },
  {
    name: "observing an endpoint with no trial running",
    reason: CONTROL_REASONS.observationNeedsTrial,
    code: "invalid_sequence",
    build: () => {
      const session = freshSession();
      setup(session);
      prepareStageA(session);
      return session;
    },
    availability: observationAvailability,
    call: (session) => observeEndpoint(session, STAGE_A, "faint_pink"),
  },
];

describe("control availability explains real domain rules", () => {
  for (const driftCase of DRIFT_CASES) {
    it(`refuses: ${driftCase.name}`, () => {
      const flags = driftCase.flags ?? OPEN_BENCH;
      const stage = stageViewFor(driftCase.build());

      const availability = driftCase.availability(stage, flags);
      expect(availability.available).toBe(false);
      expect(availability.reason).toBe(driftCase.reason);

      // …and the domain agrees, on the same state.
      const result = driftCase.call(driftCase.build());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(driftCase.code);
    });
  }

  it("offers the control as soon as the domain would accept it", () => {
    const stage = stageViewFor(readyToTitrate());
    expect(readingAvailability(stage, OPEN_BENCH)).toEqual({ available: true, reason: null });
    expect(observationAvailability(stage, OPEN_BENCH)).toEqual({
      available: true,
      reason: null,
    });
    expect(deliveryAvailability(stage, OPEN_BENCH)).toEqual({ available: true, reason: null });
  });

  it("keeps the stopcock and the swirl explained without a trial", () => {
    const session = freshSession();
    const unprepared = stageViewFor(session);
    // The burette is not even filled yet, so the stopcock cannot be turned.
    expect(stopcockAvailability(unprepared, CLOSED_STOPCOCK)).toEqual({
      available: false,
      reason: CONTROL_REASONS.stopcockNeedsBurette,
    });
    expect(swirlAvailability(unprepared, CLOSED_STOPCOCK)).toEqual({
      available: false,
      reason: CONTROL_REASONS.swirlNeedsTrial,
    });

    const prepared = stageViewFor(
      (() => {
        const s = freshSession();
        setup(s);
        prepareStageA(s);
        return s;
      })(),
    );
    expect(stopcockAvailability(prepared, CLOSED_STOPCOCK)).toEqual({
      available: false,
      reason: CONTROL_REASONS.stopcockNeedsTrial,
    });

    const titrating = stageViewFor(readyToTitrate());
    expect(stopcockAvailability(titrating, CLOSED_STOPCOCK)).toEqual({
      available: true,
      reason: null,
    });
    expect(swirlAvailability(titrating, CLOSED_STOPCOCK)).toEqual({
      available: true,
      reason: null,
    });
  });

  it("explains a closed stopcock rather than silently refusing a delivery", () => {
    const stage = stageViewFor(readyToTitrate());
    expect(deliveryAvailability(stage, CLOSED_STOPCOCK)).toEqual({
      available: false,
      reason: CONTROL_REASONS.deliveryNeedsStopcock,
    });
    // The same state with the stopcock open is deliverable: the reason is about
    // the stopcock, not about a rule the domain does not have.
    expect(deliveryAvailability(stage, OPEN_BENCH).available).toBe(true);
  });

  it("explains a trial that is already running", () => {
    const stage = stageViewFor(readyToTitrate());
    expect(startTrialAvailability(stage, OPEN_BENCH)).toEqual({
      available: false,
      reason: CONTROL_REASONS.trialAlreadyOpen,
    });
  });

  it("records a domain gap: the engine does not itself reject a second open trial", () => {
    // CHARACTERISATION, not endorsement — reported as a limitation rather than
    // worked around here, because changing engine validation is outside this
    // phase. The open trial is held in `stage.openTrial` and is never added to
    // `stage.trials`, so the `"another trial is still open"` guard inside
    // `startTrial` cannot fire from this path: it only scans the finished trials.
    //
    // Consequence: the laboratory must never offer "start trial" while one is
    // open, and it does not — `startTrialAvailability` blocks it. A hand-crafted
    // protocol action could still discard the student's own open trial, which is
    // self-inflicted and audited, but it is a gap rather than a defence.
    const session = readyToTitrate();
    const result = startTrialAction(session, STAGE_A, 2, 0);
    expect(result.ok).toBe(true);
    expect(session.public.stages[STAGE_A].openTrial?.trialNumber).toBe(2);
    expect(session.public.stages[STAGE_A].trials).toHaveLength(0);
  });
});

describe("control availability gates", () => {
  const CONTROLS: Array<{
    name: string;
    run: (stage: StageView, flags: LabControlFlags) => ControlAvailability;
  }> = [
    { name: "selection", run: (stage, flags) => selectionAvailability(flags) },
    { name: "burette setup", run: (stage, flags) => buretteSetupAvailability(flags) },
    { name: "analyte portion", run: analytePortionAvailability },
    { name: "indicator", run: indicatorAvailability },
    { name: "start trial", run: startTrialAvailability },
    { name: "stopcock", run: stopcockAvailability },
    { name: "delivery", run: deliveryAvailability },
    { name: "reading", run: readingAvailability },
    { name: "completion", run: completionAvailability },
    { name: "observation", run: observationAvailability },
    { name: "swirl", run: swirlAvailability },
    { name: "focus mode", run: (stage, flags) => focusModeAvailability(flags) },
  ];

  it("blocks everything on a submitted attempt, with one reason", () => {
    const stage = stageViewFor(readyToTitrate());
    const archived: LabControlFlags = { canWrite: false, pending: false, stopcockOpen: true };
    for (const control of CONTROLS) {
      expect(control.run(stage, archived)).toEqual({
        available: false,
        reason: CONTROL_REASONS.closed,
      });
    }
  });

  it("blocks everything while another action is in flight", () => {
    const stage = stageViewFor(readyToTitrate());
    const saving: LabControlFlags = { canWrite: true, pending: true, stopcockOpen: true };
    for (const control of CONTROLS) {
      expect(control.run(stage, saving)).toEqual({
        available: false,
        reason: CONTROL_REASONS.saving,
      });
    }
  });

  it("never returns a reason for an available control, or availability without one", () => {
    const states: Array<{ session: TitrationSession; flags: LabControlFlags }> = [
      { session: freshSession(), flags: OPEN_BENCH },
      { session: readyToTitrate(), flags: OPEN_BENCH },
      { session: readyToTitrate(), flags: CLOSED_STOPCOCK },
      { session: trialsExhausted(), flags: OPEN_BENCH },
      { session: freshSession(), flags: { canWrite: false, pending: false, stopcockOpen: false } },
    ];
    for (const state of states) {
      const stage = stageViewFor(state.session);
      for (const control of CONTROLS) {
        const result = control.run(stage, state.flags);
        expect(result.available).toBe(result.reason === null);
        if (result.reason !== null) expect(result.reason.length).toBeGreaterThan(10);
      }
    }
  });
});
