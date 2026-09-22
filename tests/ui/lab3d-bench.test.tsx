// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LabBench } from "@/components/lab/lab-bench";
import { labStateViewFor } from "../helpers/lab-fixture";
import { renderLabPanels } from "../helpers/lab-render";
import {
  addIndicator,
  addTitrant,
  startTrialAction,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import { STAGE_A, freshSession, hiddenTruth, publicStateOf, setup } from "../helpers/titration-fixtures";

// The controller imports the server actions at module scope; component tests
// inject their own sender, so the real ones must never be loaded here.
vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
}));

afterEach(cleanup);

function readyToTitrate() {
  const session = freshSession();
  setup(session);
  weighAnalyte(session, STAGE_A, 0.6);
  addIndicator(session, STAGE_A, 3);
  startTrialAction(session, STAGE_A, 1, 0);
  return session;
}

describe("2D/3D laboratory view switch (jsdom)", () => {
  it("opens on the 2D bench and switches to the 3D laboratory without losing state", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    addTitrant(session, STAGE_A, 2);
    const state = labStateViewFor(session);

    renderLabPanels({ state, panels: <LabBench initialState={state} /> });

    // 2D bench is the default: the SVG laboratory renders.
    expect(screen.getByRole("group", { name: /laboratory bench/i })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /3d laboratory/i }));

    // WebGL never initialises in jsdom: the dynamic Canvas stays on its
    // loading fallback instead of a blank canvas, while the 3D toolbar
    // (camera, flow, accessible placement) renders from the same state.
    expect(screen.getByRole("status").textContent).toMatch(/3d laboratory loading/i);
    expect(screen.getByRole("toolbar", { name: /3d laboratory controls/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /focus burette/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reading mode/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reset view/i })).toBeTruthy();
    // The authoritative reading is identical in both views (0.00 initial + 2 mL delivered).
    expect(screen.getByText(/2\.00 mL/)).toBeTruthy();

    // Switching back restores the SVG bench from the same state.
    await user.click(screen.getByRole("tab", { name: /2d bench/i }));
    expect(screen.getByRole("group", { name: /laboratory bench/i })).toBeTruthy();
  });

  it("exposes no hidden values through the 3D toolbar", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const truth = hiddenTruth(session, STAGE_A);
    const state = labStateViewFor(session);

    renderLabPanels({ state, panels: <LabBench initialState={state} /> });
    await user.click(screen.getByRole("tab", { name: /3d laboratory/i }));

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(truth.trueTitrantMolarityM.toString());
    expect(text).not.toContain(truth.equivalenceMl.toFixed(4));
    expect(publicStateOf(session)).toBeDefined();
  });
});
