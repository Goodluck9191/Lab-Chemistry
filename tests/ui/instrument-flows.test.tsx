// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { SIMULATION_PROTOCOL_VERSION } from "@/domain/simulation/titration/protocol";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import { setupApparatus, toPublicJSON, type TitrationSession } from "@/domain/simulation/titration/engine";
import { PreparationControls } from "@/components/lab/preparation-controls";
import { TitrationControls } from "@/components/lab/titration-controls";

import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabPanels, renderLabWorld } from "../helpers/lab-render";
import {
  concordantStageASession,
  freshSession,
  overshotStageASession,
  provisionStageA,
  publicStateOf,
  runTrial,
  setup,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
}));

afterEach(cleanup);

/**
 * Mount the laboratory and open the contextual prompt, which is where the
 * apparatus actions live now that the SVG bench is gone.
 */
async function openPrompt(
  state: ReturnType<typeof labStateViewFor>,
  send?: (input: unknown) => Promise<LabActionOutcome>,
) {
  const user = userEvent.setup();
  renderLabWorld({ state, send });
  await user.keyboard("{e}");
  return user;
}

// jsdom cannot render WebGL; the world mounts to its error/loading state and
// the HUD, prompt and drawers — every text surface — render for real.
vi.setConfig({ testTimeout: 30_000 });

/** Stage B active (A concordant) with its burette already set up. */
function stageBReady() {
  const session = concordantStageASession("instrument-flow-seed");
  setupApparatus(session, STAGE_B, "naoh", 0);
  return session;
}

/**
 * A send mock that applies the incoming action to a live engine session
 * through the real dispatch path and returns the new public state — the
 * server in miniature, so multi-step UI journeys advance honestly.
 */
function liveSend(session: TitrationSession) {
  let revision = 4;
  return vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async (input) => {
    const action = (input as { action: TitrationProtocolAction }).action;
    const outcome = dispatchTitrationAction(session, "exp-02", action);
    revision += 1;
    return okOutcome(toPublicJSON(session), revision, {
      accepted: outcome.accepted,
      code: outcome.code,
      message: outcome.message,
      colour: outcome.colour,
      calculationCorrect: outcome.calculationCorrect,
    });
  });
}

describe("measuring cylinder guided flow (jsdom)", () => {
  it("walks measure, deliver and records the entered volume", async () => {
    const user = userEvent.setup();
    const session = stageBReady();
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () =>
      okOutcome(publicStateOf(session), 5),
    );

    renderLabPanels({ state, send, panels: <PreparationControls initialState={state} /> });

    // The manual names a measuring cylinder for the 25.00 mL aliquot, so the
    // flow has no filler to attach and starts from an empty cylinder.
    expect(screen.getByText(/measuring cylinder · empty/i)).toBeTruthy();
    expect(screen.getByText(/pour the solution into the cylinder up to the mark/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /attach filler/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /measure in the cylinder/i }));
    expect(screen.getByText(/measuring cylinder · filled/i)).toBeTruthy();
    expect(screen.getByText(/deliver into the conical flask/i)).toBeTruthy();

    // Delivery gates the record step: the volume is entered, never generated.
    expect(screen.getByRole("button", { name: /record volume/i })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(screen.getByRole("button", { name: /deliver into the flask/i }));
    await user.type(screen.getByLabelText(/volume delivered/i), "25.00");
    await user.click(screen.getByRole("button", { name: /record volume/i }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      protocolVersion: SIMULATION_PROTOCOL_VERSION,
      attemptId: state.attemptId,
      baseRevision: 4,
      action: { type: "pipette_analyte", stageKey: STAGE_B, observedVolumeMl: 25 },
    });
  });

  it("picks the measuring cylinder without measuring anything", async () => {
    const session = stageBReady();
    const state = labStateViewFor(session);
    const send = liveSend(session);
    const user = await openPrompt(state, send);

    await user.click(screen.getByRole("button", { name: "Cylinder" }));

    // The cylinder is in hand, but it stays empty until the guided measure step
    // runs: selecting it records nothing.
    const prompt = screen.getByRole("dialog", { name: /contextual interaction prompt/i });
    expect(prompt.textContent).toMatch(/measuring cylinder/i);
    expect(screen.getByRole("button", { name: /record aliquot/i })).toHaveProperty("disabled", true);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the ware the procedure names, and never invents a pipette", async () => {
    const session = stageBReady();
    const state = labStateViewFor(session);
    const user = await openPrompt(state);

    await user.click(screen.getByRole("button", { name: "Cylinder" }));
    const prompt = screen.getByRole("dialog", { name: /contextual interaction prompt/i });
    expect(prompt.textContent).toMatch(/measuring cylinder — hcl aliquot/i);
    // The manual measures the aliquot in a cylinder; nothing offers a pipette.
    expect(document.body.textContent ?? "").not.toMatch(/pipette/i);
  });
});

describe("balance guided flow (jsdom)", () => {
  it("sequences place, tare and add in order", async () => {
    const user = userEvent.setup();
    // The burette is set up so the portion section is available and only the
    // guide sequence gates the buttons.
    const session = freshSession();
    setup(session);
    const state = labStateViewFor(session);

    renderLabPanels({ state, panels: <PreparationControls initialState={state} /> });

    const place = screen.getByRole("button", { name: /place weighing bottle/i });
    const tare = screen.getByRole("button", { name: /tare the balance/i });
    const add = screen.getByRole("button", { name: /add potassium/i });
    expect(place).toHaveProperty("disabled", false);
    expect(tare).toHaveProperty("disabled", true);
    expect(add).toHaveProperty("disabled", true);
    expect(screen.getByText(/weighing bottle missing/i)).toBeTruthy();

    await user.click(place);
    expect(screen.getByText(/not tared/i)).toBeTruthy();
    expect(screen.getByText(/tare the balance to zero/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /tare the balance/i })).toHaveProperty(
      "disabled",
      false,
    );

    await user.click(screen.getByRole("button", { name: /tare the balance/i }));
    expect(screen.getByText(/reads 0\.00 g/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /add potassium/i })).toHaveProperty(
      "disabled",
      false,
    );

    await user.click(screen.getByRole("button", { name: /add potassium/i }));
    expect(screen.getByText(/sample added/i)).toBeTruthy();
    expect(screen.getByText(/enter each weighing below/i)).toBeTruthy();
  });

  it("records the two beaker weighings and derives the sample by difference", async () => {
    const user = userEvent.setup();
    // The burette is set up so weighing is available; the guide buttons are
    // deliberately left untouched: recording works from the readings alone.
    const session = freshSession();
    setup(session);
    const state = labStateViewFor(session);
    const send = liveSend(session);

    renderLabPanels({ state, send, panels: <PreparationControls initialState={state} /> });

    await user.type(screen.getByLabelText(/empty beaker mass/i), "52.34");
    await user.click(screen.getByRole("button", { name: /record empty weighing/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/beaker plus KHP mass/i), "52.94");
    await user.click(screen.getByRole("button", { name: /record KHP weighing/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    const actions = send.mock.calls.map((call) => (call[0] as { action: unknown }).action);
    expect(actions).toEqual([
      { type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.34 },
      { type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.94 },
    ]);
    // The derived sample mass comes from the server state, not the inputs.
    await waitFor(() => {
      expect(screen.getByText(/KHP sample by difference: 0\.6 g/)).toBeTruthy();
    });
  });
});

describe("preparation journey (jsdom)", () => {
  it("walks the whole Part 2 preparation through the protocol, in order", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    const state = labStateViewFor(session);
    const send = liveSend(session);

    renderLabPanels({ state, send, panels: <PreparationControls initialState={state} /> });

    // Part I first: measure the stock, dilute it, mix it — the burette work is
    // served from the solution this makes.
    await user.type(screen.getByLabelText(/stock solution measured/i), "10");
    await user.click(screen.getByRole("button", { name: /record stock volume/i }));
    await user.click(screen.getByRole("button", { name: /^add distilled water$/i }));
    await user.click(screen.getByRole("button", { name: /stopper and swirl/i }));

    await user.click(screen.getByRole("button", { name: /rinse with tap water/i }));
    await user.click(screen.getByRole("button", { name: /obtain naoh in beaker/i }));
    await user.click(screen.getByRole("button", { name: /condition with naoh \(0\/3\)/i }));
    await user.click(screen.getByRole("button", { name: /condition with naoh \(1\/3\)/i }));
    await user.click(screen.getByRole("button", { name: /condition with naoh \(2\/3\)/i }));
    await user.type(screen.getByLabelText(/initial burette reading/i), "0.00");
    await user.click(screen.getByRole("button", { name: /fill burette/i }));
    await user.click(screen.getByRole("button", { name: /clear air bubble/i }));
    await user.type(screen.getByLabelText(/empty beaker mass/i), "52.34");
    await user.click(screen.getByRole("button", { name: /record empty weighing/i }));
    await user.type(screen.getByLabelText(/beaker plus KHP mass/i), "52.94");
    await user.click(screen.getByRole("button", { name: /record KHP weighing/i }));
    await user.click(screen.getByRole("button", { name: /dissolve in water/i }));
    await user.click(screen.getByRole("button", { name: /transfer to flask/i }));
    await user.click(screen.getByRole("button", { name: /rinse beaker \(0\/2\)/i }));
    await user.click(screen.getByRole("button", { name: /rinse beaker \(1\/2\)/i }));
    await user.click(screen.getByRole("button", { name: /^add drops$/i }));
    await user.click(screen.getByRole("button", { name: /^place under burette$/i }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(18));
    const actions = send.mock.calls.map((call) => (call[0] as { action: unknown }).action);
    expect(actions).toEqual([
      { type: "measure_naoh_stock", stageKey: STAGE_A, observedVolumeMl: 10 },
      { type: "dilute_naoh_solution", stageKey: STAGE_A },
      { type: "mix_naoh_solution", stageKey: STAGE_A },
      { type: "rinse_burette", stageKey: STAGE_A },
      { type: "obtain_naoh_portion", stageKey: STAGE_A },
      { type: "condition_burette", stageKey: STAGE_A },
      { type: "condition_burette", stageKey: STAGE_A },
      { type: "condition_burette", stageKey: STAGE_A },
      { type: "setup_apparatus", stageKey: STAGE_A, titrantKey: "naoh", initialReadingMl: 0 },
      { type: "clear_air_bubble", stageKey: STAGE_A },
      { type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.34 },
      { type: "weigh_beaker", stageKey: STAGE_A, observedMassG: 52.94 },
      { type: "dissolve_khp", stageKey: STAGE_A },
      { type: "transfer_solution", stageKey: STAGE_A },
      { type: "rinse_beaker", stageKey: STAGE_A },
      { type: "rinse_beaker", stageKey: STAGE_A },
      { type: "add_indicator", stageKey: STAGE_A, drops: 3 },
      { type: "place_flask", stageKey: STAGE_A },
    ]);
    await waitFor(() => {
      expect(screen.getByText(/KHP sample by difference: 0\.6 g/)).toBeTruthy();
    });
  });

  it("discards a completed trial into waste before the next trial", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    provisionStageA(session);
    runTrial(session, { trialNumber: 1, deliveredMl: 15 });
    const state = labStateViewFor(session);
    const send = liveSend(session);

    renderLabPanels({ state, send, panels: <TitrationControls /> });

    await user.click(screen.getByRole("button", { name: /discard into waste/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      action: { type: "discard_to_waste", stageKey: STAGE_A },
    });
    // The spent solution is gone: the disposal offers itself only once.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /discard into waste/i })).toBeNull();
    });
  });
});

describe("benchware participation (jsdom)", () => {
  it("counts discarded trials into the waste container", async () => {
    const state = labStateViewFor(overshotStageASession("waste-flow-seed"));
    const user = await openPrompt(state);

    await user.click(screen.getByRole("button", { name: "Waste" }));
    await user.click(screen.getByRole("button", { name: /^actions$/i }));

    // The discarded trial is reported in words, not only drawn as a fuller bin.
    expect(screen.getByText(/1 trial discarded so far/i)).toBeTruthy();
    expect(screen.getAllByText(/rejected: 1 \(excluded\)/i).length).toBeGreaterThan(0);
  });

  it("brings benchware guidance into the action panel on selection", async () => {
    const state = labStateViewFor(freshSession());
    const user = await openPrompt(state);

    // The prompt sits over the world while the drawer hosts the full panel.
    await user.click(screen.getByRole("button", { name: /^actions$/i }));

    await user.click(screen.getByRole("button", { name: "Beaker" }));
    expect(screen.getByText("Selected: Beaker")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Waste" }));
    expect(screen.getByText("Selected: Waste container")).toBeTruthy();
  });

  it("renders no hidden value from the session in the new instrument UI", async () => {
    const session = stageBReady();
    const state = labStateViewFor(session);
    const user = await openPrompt(state);
    await user.click(screen.getByRole("button", { name: "Cylinder" }));
    await user.click(screen.getByRole("button", { name: /^actions$/i }));

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("instrument-flow-seed");
    expect(text).not.toContain("observable");
    expect(text).not.toContain("trueTitrantMolarityM");
  });
});
