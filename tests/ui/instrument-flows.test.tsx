// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { ActionPanel } from "@/components/lab/action-panel";
import { LabBench } from "@/components/lab/lab-bench";
import { PreparationControls } from "@/components/lab/preparation-controls";
import { setupApparatus } from "@/domain/simulation/titration/engine";
import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabPanels } from "../helpers/lab-render";
import {
  concordantStageASession,
  freshSession,
  overshotStageASession,
  publicStateOf,
  setup,
  STAGE_A,
  STAGE_B,
} from "../helpers/titration-fixtures";

vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
}));

afterEach(cleanup);

function svgTitles(): string[] {
  return [...document.querySelectorAll("svg title")].map((node) => node.textContent ?? "");
}

/** Stage B active (A concordant) with its burette already set up. */
function stageBReady() {
  const session = concordantStageASession("instrument-flow-seed");
  setupApparatus(session, STAGE_B, "naoh", 0);
  return session;
}

describe("pipette guided flow (jsdom)", () => {
  it("walks attach, draw, deliver and records the entered volume", async () => {
    const user = userEvent.setup();
    const session = stageBReady();
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () =>
      okOutcome(publicStateOf(session), 5),
    );

    renderLabPanels({ state, send, panels: <PreparationControls initialState={state} /> });

    // Filler first: drawing is impossible while it sits off the pipette.
    expect(screen.getByText(/filler not attached/i)).toBeTruthy();
    expect(screen.getByText(/attach the pipette filler/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /draw up solution/i })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(screen.getByRole("button", { name: /attach filler/i }));
    expect(screen.getByText(/filler attached/i)).toBeTruthy();
    expect(screen.getByText(/draw the solution up to the mark/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /draw up solution/i }));
    expect(screen.getByText(/pipette.*filled/i)).toBeTruthy();
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
      protocolVersion: 2,
      attemptId: state.attemptId,
      baseRevision: 4,
      action: { type: "pipette_analyte", stageKey: STAGE_B, observedVolumeMl: 25 },
    });
  });

  it("selects the pipette from the bench without filling it", async () => {
    const user = userEvent.setup();
    const session = stageBReady();
    const state = labStateViewFor(session);

    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <ActionPanel initialState={state} />
        </>
      ),
    });

    await user.click(screen.getByRole("button", { name: /pipette.*filler not attached/i }));
    // Selection drives the contextual panel, but the pipette stays empty until
    // the guided draw step runs.
    expect(screen.getByText("Selected: Pipette the aliquot")).toBeTruthy();
    expect(svgTitles().join("\n")).toMatch(/state: resting/i);
  });

  it("shows the filler state on the bench drawing", () => {
    const session = stageBReady();
    const state = labStateViewFor(session);
    renderLabPanels({ state, panels: <LabBench initialState={state} /> });
    expect(svgTitles().join("\n")).toMatch(/filler not attached/i);
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
    expect(screen.getByText(/enter the mass below/i)).toBeTruthy();
  });

  it("records the mass the student entered, independent of the guide", async () => {
    const user = userEvent.setup();
    // Weighing requires the burette set up first (the engine's rule), so the
    // session prepares it; the guide buttons are deliberately left untouched.
    const session = freshSession();
    setup(session);
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () =>
      okOutcome(publicStateOf(session), 5),
    );

    renderLabPanels({ state, send, panels: <PreparationControls initialState={state} /> });

    await user.type(screen.getByLabelText(/mass you obtained/i), "0.60");
    await user.click(screen.getByRole("button", { name: /record mass/i }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      action: { type: "weigh_analyte", stageKey: STAGE_A, observedMassG: 0.6 },
    });
  });
});

describe("benchware participation (jsdom)", () => {
  it("counts discarded trials into the waste container", () => {
    const state = labStateViewFor(overshotStageASession("waste-flow-seed"));
    renderLabPanels({ state, panels: <LabBench initialState={state} /> });
    expect(svgTitles().join("\n")).toMatch(/waste container — 1 discarded trial/i);
  });

  it("brings benchware guidance into the action panel on selection", async () => {
    const user = userEvent.setup();
    const state = labStateViewFor(freshSession());

    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <ActionPanel initialState={state} />
        </>
      ),
    });

    await user.click(screen.getByRole("button", { name: /beaker.*guidance/i }));
    expect(screen.getByText("Selected: Beaker")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /waste container.*guidance/i }));
    expect(screen.getByText("Selected: Waste container")).toBeTruthy();
  });

  it("renders no hidden value from the session in the new instrument UI", () => {
    const session = stageBReady();
    const state = labStateViewFor(session);
    renderLabPanels({
      state,
      panels: (
        <>
          <LabBench initialState={state} />
          <PreparationControls initialState={state} />
          <ActionPanel initialState={state} />
        </>
      ),
    });

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("instrument-flow-seed");
    expect(text).not.toContain("observable");
    expect(text).not.toContain("trueTitrantMolarityM");
  });
});
