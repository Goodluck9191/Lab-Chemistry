// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { SIMULATION_PROTOCOL_VERSION } from "@/domain/simulation/titration/protocol";
import { LabBench } from "@/components/lab/lab-bench";
import { TitrationControls } from "@/components/lab/titration-controls";
import { PreparationControls } from "@/components/lab/preparation-controls";
import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabPanels } from "../helpers/lab-render";
import {
  addIndicator,
  addTitrant,
  readBurette,
  setupApparatus,
  startTrialAction,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import {
  DEFAULT_SEED,
  STAGE_A,
  STAGE_B,
  concordantStageASession,
  freshSession,
  hiddenTruth,
  publicStateOf,
  setup,
} from "../helpers/titration-fixtures";

// The controller imports the server actions at module scope; component tests
// inject their own sender, so the real ones must never be loaded here.
vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

/**
 * SVG `<title>` text, which is what names each piece of apparatus for a screen
 * reader. Queried directly rather than through `getByTitle`, whose SVG handling
 * differs by version — the assertion here is about the accessible name, which is
 * the part that matters.
 */
function svgTitles(): string[] {
  return Array.from(document.querySelectorAll("title")).map((node) => node.textContent ?? "");
}

/** A session sitting at the start of trial 1, ready to receive titrant. */
function readyToTitrate() {
  const session = freshSession();
  setup(session);
  weighAnalyte(session, STAGE_A, 0.6);
  addIndicator(session, STAGE_A, 3);
  startTrialAction(session, STAGE_A, 1, 0);
  return session;
}

describe("laboratory bench (jsdom)", () => {
  it("renders the bench apparatus with accessible names", () => {
    const session = readyToTitrate();
    renderLabPanels({
      state: labStateViewFor(session),
      panels: (
        <>
          <LabBench initialState={labStateViewFor(session)} />
          <TitrationControls />
        </>
      ),
    });

    expect(screen.getByRole("group", { name: /laboratory bench/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /burette stopcock: closed/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /conical flask/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reagent bottle: sodium hydroxide/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /indicator bottle: phenolphthalein/i })).toBeTruthy();

    const titles = svgTitles().join("\n");
    for (const apparatus of [
      /conical flask, 250 mL/i,
      /burette stand and clamp/i,
      /analytical balance/i,
      /waste container/i,
      /white tile/i,
      /burette, 50 mL, graduated to 0.1 mL/i,
      /volumetric flask/i,
      /beaker/i,
    ]) {
      expect(titles).toMatch(apparatus);
    }
    // Stage A weighs its sample, so no aliquot ware is drawn at all.
    expect(titles).not.toMatch(/pipette|measuring cylinder/i);
  });

  it("draws the ware the procedure names for the measured aliquot", () => {
    // Stage A is complete, so stage B is the active stage on the bench.
    const session = concordantStageASession("bench-vessel-seed");
    setupApparatus(session, STAGE_B, "naoh", 0);
    const state = labStateViewFor(session);
    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <TitrationControls />
        </>
      ),
    });

    // The manual measures the HCl aliquot in a cylinder; no pipette is offered.
    expect(screen.getByRole("button", { name: /measuring cylinder, 25 mL/i })).toBeTruthy();
    const titles = svgTitles().join("\n");
    expect(titles).toMatch(/measuring cylinder, 25 mL/i);
    expect(titles).not.toMatch(/pipette/i);
  });

  it("reflects the persisted flask colour in the drawing and in text", () => {
    const session = readyToTitrate();
    addTitrant(session, STAGE_A, hiddenTruth(session, STAGE_A).observableMl);
    const state = labStateViewFor(session);

    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <TitrationControls />
        </>
      ),
    });

    // Text, not colour alone: the flask label shows the colour name.
    // The description is in the flask's accessible title.
    expect(
      screen.getAllByText(/a faint pink that persists marks the endpoint/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /contents: faint pink/i })).toBeTruthy();
    // The drawing itself carries the endpoint layer.
    expect(document.querySelector(".lab-flask-colour")).toBeTruthy();
  });

  it("opens the stopcock from the bench and delivers titrant through the protocol", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => {
      const next = readyToTitrate();
      addTitrant(next, STAGE_A, 1);
      return okOutcome(publicStateOf(next), 5);
    });

    renderLabPanels({
      state,
      send,
      panels: (
        <>
          <LabBench initialState={state} />
          <TitrationControls />
        </>
      ),
    });

    const increments = screen.getAllByRole("button", { name: /1\.00 mL/ });
    expect(increments[0]).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: /burette stopcock: closed/i }));
    expect(screen.getByRole("button", { name: /burette stopcock: open/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /1\.00 mL/ }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({
      protocolVersion: SIMULATION_PROTOCOL_VERSION,
      attemptId: state.attemptId,
      baseRevision: 4,
      action: { type: "add_titrant", stageKey: STAGE_A, volumeMl: 1 },
    });
  });

  it("swirls the flask when the flask itself is activated", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const state = labStateViewFor(session);

    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <TitrationControls />
        </>
      ),
    });

    expect(screen.getByText("Flask at rest.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /conical flask\. contents: colourless/i }));
    expect(screen.getByText("Flask swirling.")).toBeTruthy();
  });

  it("disables the controls while an action is in flight", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    let release: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<ReturnType<typeof okOutcome>>((resolve) => {
          release = () => resolve(okOutcome(publicStateOf(session), 5));
        }),
    );

    renderLabPanels({
      state,
      send,
      panels: (
        <>
          <LabBench initialState={state} />
          <TitrationControls />
        </>
      ),
    });

    await user.click(screen.getByRole("button", { name: /open stopcock/i }));
    await user.click(screen.getAllByRole("button", { name: /0\.10 mL/ })[0]);

    // Second click cannot start a second action on the same revision.
    const again = screen.getAllByRole("button", { name: /0\.10 mL/ })[0];
    expect(again).toHaveProperty("disabled", true);
    await user.click(again);
    expect(send).toHaveBeenCalledTimes(1);

    release?.();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it("records the initial reading, the mass and the indicator through actions", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () =>
      okOutcome(publicStateOf(session), 5),
    );

    renderLabPanels({
      state,
      send,
      panels: <PreparationControls initialState={state} />,
    });

    await user.type(screen.getByLabelText(/initial burette reading/i), "0.00");
    await user.click(screen.getByRole("button", { name: /fill burette/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      action: {
        type: "setup_apparatus",
        stageKey: STAGE_A,
        titrantKey: "naoh",
        initialReadingMl: 0,
      },
    });

    // A bad reading is refused before it is ever sent.
    await user.type(screen.getByLabelText(/empty beaker mass/i), "52.34785");
    expect(screen.getByRole("alert").textContent).toMatch(/2 decimal places/i);
    expect(screen.getByRole("button", { name: /record empty weighing/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("never renders a hidden value from the session", () => {
    const session = readyToTitrate();
    const truth = hiddenTruth(session, STAGE_A);
    const state = labStateViewFor(session);

    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <TitrationControls />
          <PreparationControls initialState={state} />
        </>
      ),
    });

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(DEFAULT_SEED);
    expect(text).not.toContain(truth.trueTitrantMolarityM.toString());
    expect(text).not.toContain(String(truth.analyteMoles));
    expect(text).not.toContain(truth.equivalenceMl.toFixed(4));
    expect(text).not.toContain("observable");
    // The numbers that ARE shown are the student's own readings.
    expect(text).toContain("0.00 mL");
  });

  it("records the final reading and closes the trial", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    addTitrant(session, STAGE_A, 5);
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () =>
      okOutcome(publicStateOf(session), 5),
    );

    renderLabPanels({ state, send, panels: <TitrationControls /> });

    await user.type(screen.getByLabelText(/final burette reading/i), "5.00");
    await user.click(screen.getByRole("button", { name: /record final reading/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      action: { type: "read_burette", stageKey: STAGE_A, observedFinalMl: 5 },
    });
  });

  it("blocks completion until a final reading exists", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    addTitrant(session, STAGE_A, 5);
    const state = labStateViewFor(session);
    const send = vi.fn(async () => okOutcome(publicStateOf(session), 5));

    renderLabPanels({ state, send, panels: <TitrationControls /> });

    expect(screen.getByRole("button", { name: /complete trial/i })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: /complete trial/i }));
    expect(send).not.toHaveBeenCalled();
  });

  it("shows no controls at all on a frozen attempt", () => {
    const session = readyToTitrate();
    const state = labStateViewFor(session, { canWrite: false });

    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <TitrationControls />
          <PreparationControls initialState={state} />
        </>
      ),
    });

    for (const button of screen
      .getAllByRole("button")
      .filter((element) => element.tagName === "BUTTON")) {
      expect(button).toHaveProperty("disabled", true);
    }
    // SVG click targets are inert too: no apparatus can be activated at all.
    expect(document.querySelectorAll('svg [role="button"]').length).toBe(0);
    expect(screen.getByText(/read-only attempt/i)).toBeTruthy();
  });

  it("keeps the burette reading visible after a reload of the same state", () => {
    const session = readyToTitrate();
    addTitrant(session, STAGE_A, 2);
    readBurette(session, STAGE_A, 2);
    const state = labStateViewFor(session);

    renderLabPanels({ state, panels: <LabBench initialState={state} /> });
    expect(screen.getByText("Burette: 2.00 mL")).toBeTruthy();
    expect(svgTitles().join("\n")).toMatch(/meniscus near 2\.00 mL/i);
  });
});
