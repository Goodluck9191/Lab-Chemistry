// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { SIMULATION_PROTOCOL_VERSION } from "@/domain/simulation/titration/protocol";
import { PreparationControls } from "@/components/lab/preparation-controls";
import { TitrationControls } from "@/components/lab/titration-controls";
import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabPanels, renderLabWorld } from "../helpers/lab-render";
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

// WebGL never initialises in jsdom, so the Canvas lands on its error boundary
// while the HUD, the contextual prompt and the drawers render for real.
vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);

/** A session sitting at the start of trial 1, ready to receive titrant. */
function readyToTitrate() {
  const session = freshSession();
  setup(session);
  weighAnalyte(session, STAGE_A, 0.6);
  addIndicator(session, STAGE_A, 3);
  startTrialAction(session, STAGE_A, 1, 0);
  return session;
}

async function openWorld(
  state: ReturnType<typeof labStateViewFor>,
  send?: (input: unknown) => Promise<LabActionOutcome>,
) {
  const user = userEvent.setup();
  renderLabWorld({ state, send });
  return user;
}

async function openPrompt(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{e}");
  return screen.getByRole("dialog", { name: /contextual interaction prompt/i });
}

/**
 * The immersive laboratory.
 *
 * This suite used to drive the 2D SVG bench, which no longer exists. The
 * assertions that mattered — accessible names, the protocol payloads, honest
 * colour reporting, frozen attempts, hidden-value protection — are made here
 * against the world's real text surfaces: the HUD, the contextual prompt and
 * the drawers that hold the panels.
 */
describe("the immersive laboratory (jsdom)", () => {
  it("opens the world with a minimal HUD, and no 2D laboratory anywhere", async () => {
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const user = await openWorld(state);

    // The world and its four corners.
    expect(screen.getByLabelText(/immersive 3d laboratory/i)).toBeTruthy();
    expect(screen.getByText(/experiment 2/i)).toBeTruthy();
    expect(screen.getByRole("status", { name: /current objective/i })).toBeTruthy();
    expect(screen.getByRole("status", { name: /trial progress/i })).toBeTruthy();

    // No view tabs, no permanent toolbar, no permanent sidebars.
    expect(screen.queryByRole("tab", { name: /2d bench/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /3d laboratory/i })).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.querySelectorAll("svg [role='button']").length).toBe(0);

    // The contextual prompt is where the apparatus is addressed from, and it
    // names each piece the way a student would.
    const prompt = await openPrompt(user);
    expect(prompt.textContent).toMatch(/burette/i);
    expect(prompt.textContent).toMatch(/flask/i);
    expect(prompt.textContent).toMatch(/balance/i);
  });

  it("reflects the persisted flask colour in words as well as in the world", async () => {
    const session = readyToTitrate();
    addTitrant(session, STAGE_A, hiddenTruth(session, STAGE_A).observableMl);
    const state = labStateViewFor(session);
    const user = await openWorld(state);

    // Text, not colour alone: the HUD names the flask's state, so a student who
    // cannot read the tint of the liquid still knows where they are.
    expect(screen.getByText(/flask: faint pink/i)).toBeTruthy();

    const prompt = await openPrompt(user);
    await user.click(screen.getByRole("button", { name: "Flask" }));
    expect(prompt.textContent).toMatch(/erlenmeyer flask/i);
  });

  it("opens the stopcock and delivers titrant through the protocol", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => {
      const next = readyToTitrate();
      addTitrant(next, STAGE_A, 1);
      return okOutcome(publicStateOf(next), 5);
    });

    renderLabWorld({ state, send });
    await openPrompt(user);

    // The valve turns on the burette's own panel, and the HUD reports where it
    // stopped.
    await user.click(screen.getByRole("button", { name: "Burette" }));
    await user.click(screen.getByRole("button", { name: /open the stopcock/i }));
    expect(screen.getAllByText(/stopcock: cracked open/i).length).toBeGreaterThan(0);

    // With the path open, the panel's delivery goes through the same protocol.
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    await user.click(screen.getAllByRole("button", { name: /1\.00 mL/ })[0]);

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({
      protocolVersion: SIMULATION_PROTOCOL_VERSION,
      attemptId: state.attemptId,
      baseRevision: 4,
      action: { type: "add_titrant", stageKey: STAGE_A, volumeMl: 1 },
    });
  });

  it("swirls the flask from its own context", async () => {
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const user = await openWorld(state);
    await openPrompt(user);

    await user.click(screen.getByRole("button", { name: "Flask" }));

    const swirl = screen.getByRole("button", { name: /swirl the flask/i });
    expect(swirl.getAttribute("aria-pressed")).toBe("false");
    await user.click(swirl);

    expect(screen.getByRole("button", { name: /stop swirling/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop swirling/i }).getAttribute("aria-pressed")).toBe(
      "true",
    );
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

    renderLabPanels({ state, send, panels: <TitrationControls /> });

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

    renderLabPanels({ state, send, panels: <PreparationControls initialState={state} /> });

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

  it("never renders a hidden value anywhere in the laboratory", async () => {
    const session = readyToTitrate();
    const truth = hiddenTruth(session, STAGE_A);
    const state = labStateViewFor(session);
    const user = await openWorld(state);

    await openPrompt(user);
    await user.click(screen.getByRole("button", { name: "Flask" }));
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    await user.click(screen.getByRole("button", { name: /^results$/i }));

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(DEFAULT_SEED);
    expect(text).not.toContain(truth.trueTitrantMolarityM.toString());
    expect(text).not.toContain(String(truth.analyteMoles));
    expect(text).not.toContain(truth.equivalenceMl.toFixed(4));
    expect(text).not.toContain("observable");
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

  it("shows no controls at all on a frozen attempt", async () => {
    const session = readyToTitrate();
    const state = labStateViewFor(session, { canWrite: false });
    const user = await openWorld(state);
    await openPrompt(user);

    // Every bench control names the reason it is inert, on the control itself.
    await user.click(screen.getByRole("button", { name: "Burette" }));
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /open the stopcock/i })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(screen.getByRole("button", { name: "Flask" }));
    expect(screen.getByRole("button", { name: /pick the flask up/i })).toHaveProperty(
      "disabled",
      true,
    );

    // And the panel's own actions are inert too.
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    for (const button of screen.getAllByRole("button", { name: /fill burette|complete trial/i })) {
      expect(button).toHaveProperty("disabled", true);
    }
  });

  it("keeps the burette reading visible after a reload of the same state", async () => {
    const session = readyToTitrate();
    addTitrant(session, STAGE_A, 2);
    readBurette(session, STAGE_A, 2);
    const state = labStateViewFor(session);

    await openWorld(state);

    // The stored meniscus is on screen, in the student's own units.
    expect(screen.getByText(/burette: 2\.00 ml/i)).toBeTruthy();
  });

  it("offers the ware the procedure names, and no pipette, on the aliquot stage", async () => {
    // Stage A is complete, so Stage B is the active stage in the laboratory.
    const session = concordantStageASession("world-vessel-seed");
    setupApparatus(session, STAGE_B, "naoh", 0);
    const state = labStateViewFor(session);
    const user = await openWorld(state);

    const prompt = await openPrompt(user);
    await user.click(screen.getByRole("button", { name: "Cylinder" }));

    // The manual measures the HCl aliquot in a cylinder.
    expect(prompt.textContent).toMatch(/measuring cylinder/i);
    expect(document.body.textContent ?? "").not.toMatch(/pipette/i);
  });
});
