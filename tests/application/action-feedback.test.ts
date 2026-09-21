import { describe, expect, it } from "vitest";
import {
  CONFLICT_FEEDBACK,
  feedbackForOutcome,
  feedbackForStart,
  type ActionFeedback,
} from "@/components/lab/action-feedback";
import {
  addTitrant,
  startTrialAction,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import {
  DEFAULT_SEED,
  STAGE_A,
  freshSession,
  hiddenTruth,
  prepareStageA,
  publicStateOf,
  runTrial,
  setup,
} from "../helpers/titration-fixtures";

/**
 * The console tells the student what the laboratory did. Two properties matter:
 * it must be SPECIFIC (a titration step, not "Success!"), and it may only use
 * values the student supplied or the server returned — never a hidden one.
 */

/** Every action type the protocol carries, so none silently loses its wording. */
const PROTOCOL_ACTION_TYPES = [
  "setup_apparatus",
  "weigh_analyte",
  "pipette_analyte",
  "add_indicator",
  "start_trial",
  "add_titrant",
  "read_burette",
  "observe_endpoint",
  "complete_trial",
  "report_molarity",
  "record_observation",
  "measure_naoh_stock",
  "dilute_naoh_solution",
  "mix_naoh_solution",
  "obtain_naoh_portion",
  "rinse_burette",
  "condition_burette",
  "clear_air_bubble",
  "weigh_beaker",
  "dissolve_khp",
  "transfer_solution",
  "rinse_beaker",
  "place_flask",
  "discard_to_waste",
];

function midTrial(volumeMl: number): { session: TitrationSession; colour: string | null } {
  const session = freshSession();
  setup(session);
  prepareStageA(session);
  startTrialAction(session, STAGE_A, 1, 0);
  const result = addTitrant(session, STAGE_A, volumeMl);
  return { session, colour: result.ok ? (result.colour ?? null) : null };
}

/** A session whose first trial was closed after delivering `deliveredMl`. */
function closedTrial(deliveredMl: number): TitrationSession {
  const session = freshSession();
  setup(session);
  prepareStageA(session);
  runTrial(session, { trialNumber: 1, deliveredMl });
  return session;
}

function outcomeFor(
  session: TitrationSession,
  action: { type: string } & Record<string, unknown>,
  extras: { colour?: string | null; calculationCorrect?: boolean | null } = {},
): ActionFeedback | null {
  return feedbackForOutcome({
    action,
    accepted: true,
    colour: extras.colour ?? null,
    calculationCorrect: extras.calculationCorrect ?? null,
    publicState: publicStateOf(session),
  });
}

describe("action feedback while an action is in flight", () => {
  it("describes the step, never a generic success", () => {
    for (const type of PROTOCOL_ACTION_TYPES) {
      const message = feedbackForStart({ type });
      expect(message.length).toBeGreaterThan(5);
      expect(message.endsWith("…")).toBe(true);
      expect(message.toLowerCase()).not.toContain("success");
    }
  });

  it("names the actual apparatus for the steps that have one", () => {
    expect(feedbackForStart({ type: "setup_apparatus" })).toMatch(/burette/i);
    expect(feedbackForStart({ type: "add_titrant" })).toMatch(/titrant/i);
    expect(feedbackForStart({ type: "complete_trial" })).toMatch(/trial/i);
  });

  it("falls back to a neutral message for an action it does not know", () => {
    expect(feedbackForStart({ type: "polish_the_bench" })).toBe("Saving…");
  });
});

describe("action feedback after the server answered", () => {
  it("says nothing at all when the engine refused the action", () => {
    // The engine's own wording is shown as an alert; the console stays silent so
    // the student is told once, and never twice with two different messages.
    const session = freshSession();
    expect(
      feedbackForOutcome({
        action: { type: "weigh_analyte", stageKey: STAGE_A, observedMassG: 0.6 },
        accepted: false,
        colour: null,
        calculationCorrect: null,
        publicState: publicStateOf(session),
      }),
    ).toBeNull();
  });

  it("echoes the student's own numbers back for the preparation steps", () => {
    const session = freshSession();
    const setup1 = outcomeFor(session, {
      type: "setup_apparatus",
      stageKey: STAGE_A,
      titrantKey: "naoh",
      initialReadingMl: 0.4,
    });
    expect(setup1?.tone).toBe("success");
    expect(setup1?.message).toContain("0.40 mL");

    const mass = outcomeFor(session, {
      type: "weigh_analyte",
      stageKey: STAGE_A,
      observedMassG: 0.61,
    });
    expect(mass?.message).toContain("0.61 g");

    const drops = outcomeFor(session, { type: "add_indicator", stageKey: STAGE_A, drops: 3 });
    expect(drops?.message).toContain("3 drops");

    // Part I echoes the measured stock volume too, and never names a
    // concentration the procedure does not state.
    const stock = outcomeFor(session, {
      type: "measure_naoh_stock",
      stageKey: STAGE_A,
      observedVolumeMl: 10,
    });
    expect(stock?.message).toContain("10.00 mL");
    expect(stock?.message).not.toMatch(/0\.2\s*M/i);

    const mixed = outcomeFor(session, { type: "mix_naoh_solution", stageKey: STAGE_A });
    expect(mixed?.tone).toBe("success");
    expect(mixed?.message).not.toMatch(/0\.2\s*M/i);
  });

  it("reports the delivered volume and the colour the laboratory observed", () => {
    const early = midTrial(0.5);
    const earlyFeedback = outcomeFor(
      early.session,
      { type: "add_titrant", stageKey: STAGE_A, volumeMl: 0.5 },
      { colour: early.colour },
    );
    expect(earlyFeedback?.message).toContain("0.50 mL");
    expect(earlyFeedback?.tone).toBe("info");

    const session = freshSession();
    setup(session);
    prepareStageA(session);
    startTrialAction(session, STAGE_A, 1, 0);
    const observable = hiddenTruth(session, STAGE_A).observableMl;

    // At the observable endpoint the ladder gives faint pink, which is the
    // endpoint the manual describes: reported as a successful observation.
    const atEndpoint = addTitrant(session, STAGE_A, observable);
    const endpointFeedback = outcomeFor(
      session,
      { type: "add_titrant", stageKey: STAGE_A, volumeMl: observable },
      { colour: atEndpoint.ok ? atEndpoint.colour : null },
    );
    expect(endpointFeedback?.message).toMatch(/faint pink/i);
    expect(endpointFeedback?.tone).toBe("success");

    // One mL beyond it is deep pink: the message warns rather than celebrates.
    const past = addTitrant(session, STAGE_A, 1);
    const pastFeedback = outcomeFor(
      session,
      { type: "add_titrant", stageKey: STAGE_A, volumeMl: 1 },
      { colour: past.ok ? past.colour : null },
    );
    expect(pastFeedback?.message).toMatch(/deep pink/i);
    expect(pastFeedback?.tone).toBe("warning");
  });

  it("distinguishes a recorded trial from one rejected for overshooting", () => {
    const observable = hiddenTruth(freshSession(), STAGE_A).observableMl;

    const recorded = outcomeFor(closedTrial(observable), {
      type: "complete_trial",
      stageKey: STAGE_A,
    });
    expect(recorded?.tone).toBe("success");
    expect(recorded?.message).toMatch(/trial 1 recorded/i);

    const undershot = outcomeFor(closedTrial(Math.max(1, observable - 2)), {
      type: "complete_trial",
      stageKey: STAGE_A,
    });
    expect(undershot?.tone).toBe("warning");
    expect(undershot?.message).toMatch(/stopped before the endpoint/i);

    const overshot = outcomeFor(closedTrial(observable + 1), {
      type: "complete_trial",
      stageKey: STAGE_A,
    });
    expect(overshot?.tone).toBe("danger");
    expect(overshot?.message).toMatch(/rejected/i);
    expect(overshot?.message).toMatch(/repeat the trial/i);
  });

  it("reports the verdict on a submitted calculation without revealing the answer", () => {
    const session = closedTrial(hiddenTruth(freshSession(), STAGE_A).observableMl);
    const action = { type: "report_molarity", stageKey: STAGE_A, trialNumber: 1, studentMolarityM: 0.1 };

    const accepted = outcomeFor(session, action, { calculationCorrect: true });
    expect(accepted?.tone).toBe("success");
    expect(accepted?.message).toMatch(/agrees/i);

    const outside = outcomeFor(session, action, { calculationCorrect: false });
    expect(outside?.tone).toBe("warning");
    expect(outside?.message).toMatch(/tolerance/i);

    const unknown = outcomeFor(session, action, { calculationCorrect: null });
    expect(unknown?.tone).toBe("info");
    expect(unknown?.message).toContain("trial 1");
  });

  it("compares the student's observation with what the flask showed", () => {
    const { session, colour } = midTrial(0.5);
    const matching = outcomeFor(
      session,
      { type: "observe_endpoint", stageKey: STAGE_A, claimedColour: colour },
      { colour },
    );
    expect(matching?.tone).toBe("success");

    const mismatching = outcomeFor(
      session,
      { type: "observe_endpoint", stageKey: STAGE_A, claimedColour: "deep_pink" },
      { colour },
    );
    expect(mismatching?.tone).toBe("warning");
    expect(mismatching?.message).toMatch(/you reported/i);
    expect(mismatching?.message).toMatch(/showed/i);
  });

  it("stays silent for an action it has no honest wording for", () => {
    const session = freshSession();
    expect(
      feedbackForOutcome({
        action: { type: "polish_the_bench" },
        accepted: true,
        colour: null,
        calculationCorrect: null,
        publicState: publicStateOf(session),
      }),
    ).toBeNull();
  });

  it("words a reconciled revision as a reconciliation, not as a completed action", () => {
    expect(CONFLICT_FEEDBACK.message).toMatch(/reloaded/i);
    expect(CONFLICT_FEEDBACK.message).toMatch(/Nothing was/i);
  });
});

describe("action feedback never leaks a hidden value", () => {
  it("contains no seed, concentration or endpoint from the session", () => {
    const seedSession = freshSession();
    const truth = hiddenTruth(seedSession, STAGE_A);
    const observable = truth.observableMl;

    const messages: string[] = [CONFLICT_FEEDBACK.message];
    for (const type of PROTOCOL_ACTION_TYPES) messages.push(feedbackForStart({ type }));

    // A live delivery, whose message names the colour the flask showed.
    const endpointSession = freshSession();
    setup(endpointSession);
    prepareStageA(endpointSession);
    startTrialAction(endpointSession, STAGE_A, 1, 0);
    const atEndpoint = addTitrant(endpointSession, STAGE_A, observable);

    const collected = [
      outcomeFor(seedSession, { type: "setup_apparatus", stageKey: STAGE_A, initialReadingMl: 0 }),
      outcomeFor(seedSession, { type: "weigh_analyte", stageKey: STAGE_A, observedMassG: 0.6 }),
      outcomeFor(seedSession, { type: "add_indicator", stageKey: STAGE_A, drops: 3 }),
      outcomeFor(seedSession, { type: "read_burette", stageKey: STAGE_A, observedFinalMl: 12 }),
      outcomeFor(
        endpointSession,
        { type: "add_titrant", stageKey: STAGE_A, volumeMl: observable },
        { colour: atEndpoint.ok ? atEndpoint.colour : null },
      ),
      outcomeFor(closedTrial(observable), { type: "complete_trial", stageKey: STAGE_A }),
      outcomeFor(closedTrial(observable + 1), { type: "complete_trial", stageKey: STAGE_A }),
      outcomeFor(closedTrial(observable), {
        type: "report_molarity",
        stageKey: STAGE_A,
        trialNumber: 1,
        studentMolarityM: 0.1,
      }),
    ];
    for (const feedback of collected) if (feedback) messages.push(feedback.message);

    const text = messages.join("\n");
    expect(text).not.toContain(DEFAULT_SEED);
    expect(text).not.toContain(String(truth.trueTitrantMolarityM));
    expect(text).not.toContain(truth.equivalenceMl.toFixed(4));
    expect(text).not.toContain(String(truth.analyteMoles));
    // …and it did say something.
    expect(text).toMatch(/faint pink/i);
  });
});
