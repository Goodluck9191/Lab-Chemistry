// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { SIMULATION_PROTOCOL_VERSION } from "@/domain/simulation/titration/protocol";
import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabWorld } from "../helpers/lab-render";
import { recorderSpecsFor } from "@/components/lab/3d/ui/RecorderOverlay";
import {
  addIndicator,
  addTitrant,
  startTrialAction,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import {
  STAGE_A,
  freshSession,
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

/**
 * The teaching surfaces added with the physical laboratory (§25 procedure card,
 * §26 help, §28 recorder). Each is checked for the property that makes it
 * honest: it guides but performs nothing, and the student's place in the manual
 * rides along with their next real action.
 */
describe("the laboratory's teaching surfaces (jsdom)", () => {
  it("shows one written procedure step, pages through it, and persists the step with the next action", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () => {
      const next = readyToTitrate();
      addTitrant(next, STAGE_A, 1);
      return okOutcome(publicStateOf(next), 5);
    });

    renderLabWorld({ state, send });

    // The card names the step and nothing performs it.
    expect(screen.getByText(/step 1 of \d+/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByText(/step 2 of \d+/i)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();

    // Deliver through the accessible lab; the envelope carries step 2.
    await user.keyboard("{e}");
    await user.click(screen.getByRole("button", { name: "Burette" }));
    await user.click(screen.getByRole("button", { name: /open the stopcock/i }));
    await user.click(screen.getByRole("button", { name: /^accessible lab$/i }));
    await user.click(screen.getAllByRole("button", { name: /1\.00 mL/ })[0]);

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      protocolVersion: SIMULATION_PROTOCOL_VERSION,
      procedureStep: 2,
      action: { type: "add_titrant", stageKey: STAGE_A, volumeMl: 1 },
    });
  });

  it("offers help that explains and points, but performs nothing", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => okOutcome(publicStateOf(session), 5));

    renderLabWorld({ state, send });

    // The HUD and the step card both offer Help; either opens the same surface.
    await user.click(screen.getAllByRole("button", { name: /^help$/i })[0]);
    const help = screen.getByRole("dialog", { name: /^help$/i });
    expect(help.textContent).toMatch(/where can i find the burette/i);
    expect(help.textContent).toMatch(/will not perform a step for you/i);

    // "Show me" points the camera; it never sends a protocol action.
    await user.click(screen.getAllByRole("button", { name: /show me/i })[0]);
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /^help$/i })).toBeNull();
  });

  it("opens the single recorder for the reading that is waiting", async () => {
    const user = userEvent.setup();
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => okOutcome(publicStateOf(session), 5));

    renderLabWorld({ state, send });

    await user.click(screen.getByRole("button", { name: /^record$/i }));
    const dialog = screen.getByRole("dialog", { name: /record a reading/i });
    expect(dialog.textContent).toMatch(/your reading/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("derives the recordable readings from the stage (pure)", () => {
    const session = readyToTitrate();
    const state = labStateViewFor(session);
    const stage = state.publicState.stages[STAGE_A] as never;
    const specs = recorderSpecsFor({
      stage: {
        key: STAGE_A,
        portion: { kind: "weighed_mass", recordedMassG: 0.6 },
        preparationState: { beakerMassG: 52.13, beakerPlusKhpMassG: 52.74 },
        burette: { setup: true, readingPrecisionMl: 0.01 },
        openTrial: { trialNumber: 1, finalReadingMl: null },
        nextTrialNumber: null,
      },
      solution: { required: false, stockVolumeMl: null },
    });
    void stage;
    // A running trial whose final reading is unrecorded is the reading waiting.
    expect(specs.map((spec) => spec.kind)).toContain("burette_final");
  });
});
