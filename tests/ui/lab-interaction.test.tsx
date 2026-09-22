// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionConsole } from "@/components/lab/action-console";
import { LabNotices } from "@/components/lab/lab-notices";
import { TitrationControls } from "@/components/lab/titration-controls";
import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabPanels, renderLabWorld } from "../helpers/lab-render";
import { addIndicator, startTrialAction, weighAnalyte } from "@/domain/simulation/titration/engine";
import { STAGE_A, freshSession, publicStateOf, setup } from "../helpers/titration-fixtures";

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

// WebGL never initialises in jsdom, so the world mounts as its loading state
// while the HUD, the prompt and the drawers — the parts a student interacts
// with by text — render for real.
vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);

/** Burette filled, sample weighed, indicator in: one step from titrating. */
function prepared() {
  const session = freshSession();
  setup(session);
  weighAnalyte(session, STAGE_A, 0.6);
  addIndicator(session, STAGE_A, 3);
  return session;
}

/** A stage with trial 1 open, so every titration control is live. */
function titrating() {
  const session = prepared();
  startTrialAction(session, STAGE_A, 1, 0);
  return session;
}

/**
 * Mount the laboratory and open the contextual prompt — the in-world surface
 * that replaced the 2D bench's click targets. E is the documented key for it.
 */
async function openLab(
  state: ReturnType<typeof labStateViewFor>,
  send?: (input: unknown) => Promise<ReturnType<typeof okOutcome>>,
) {
  const user = userEvent.setup();
  renderLabWorld({ state, send });
  await user.keyboard("{e}");
  expect(screen.getByRole("dialog", { name: /contextual interaction prompt/i })).toBeTruthy();
  return user;
}

async function openActionsDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^actions$/i }));
}

describe("selecting apparatus in the laboratory drives the action panel", () => {
  it("brings the burette's controls into context when the burette is picked", async () => {
    const state = labStateViewFor(prepared());
    const user = await openLab(state);

    await user.click(screen.getByRole("button", { name: "Burette" }));
    await openActionsDrawer(user);

    expect(screen.getByText(/^Selected: Prepare the burette$/)).toBeTruthy();
    expect(screen.getByText("In context")).toBeTruthy();
  });

  it("selects the burette from the keyboard as well as the pointer", async () => {
    const state = labStateViewFor(prepared());
    const user = await openLab(state);

    // The same picker button, reached by keyboard only.
    const picker = screen.getByRole("button", { name: "Burette" });
    picker.focus();
    await user.keyboard("{Enter}");
    await openActionsDrawer(user);

    expect(screen.getByText(/^Selected: Prepare the burette$/)).toBeTruthy();
  });

  it("focuses the matching section for a reagent, the flask and the balance", async () => {
    const state = labStateViewFor(prepared());
    const user = await openLab(state);
    await openActionsDrawer(user);

    // With nothing picked, the panel says what to do instead of showing a focus.
    expect(screen.getByText(/select an apparatus or reagent on the bench/i)).toBeTruthy();

    // The analyte bottle focuses the sample, not the burette.
    // Exact name: the picker button, not the action panel's "Add …" button.
    await user.click(screen.getByRole("button", { name: "Potassium hydrogen phthalate" }));
    expect(screen.getByText(/^Selected: Measure the sample$/)).toBeTruthy();

    // Picking the flask afterwards must repoint the panel: the apparatus the
    // student touched last is the one in context.
    await user.click(screen.getByRole("button", { name: "Flask" }));
    expect(screen.getByText(/^Selected: Titrate in the flask$/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Balance" }));
    expect(screen.getByText(/^Selected: Weigh the sample$/)).toBeTruthy();
  });
});

describe("reading mode is the close-up of the burette scale", () => {
  it("opens from the burette's context, is named, and closes on Escape", async () => {
    const state = labStateViewFor(titrating());
    const user = await openLab(state);

    expect(screen.queryByRole("dialog", { name: /record burette reading/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Burette" }));
    await user.click(screen.getByRole("button", { name: /reading mode/i }));

    const dialog = screen.getByRole("dialog", { name: /record burette reading/i });
    expect(dialog).toBeTruthy();
    // It asks for the student's own reading of the meniscus — it never tells
    // them the answer.
    expect(screen.getByText(/read the bottom of the meniscus/i)).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /record burette reading/i })).toBeNull(),
    );
  });

  it("closes from its own control", async () => {
    const state = labStateViewFor(titrating());
    const user = await openLab(state);

    await user.click(screen.getByRole("button", { name: "Burette" }));
    await user.click(screen.getByRole("button", { name: /reading mode/i }));
    expect(screen.getByRole("dialog", { name: /record burette reading/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /back to lab/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /record burette reading/i })).toBeNull(),
    );
  });
});

describe("the stopcock is a valve, not a switch", () => {
  it("steps through its openings once a trial is running", async () => {
    const state = labStateViewFor(titrating());
    const user = await openLab(state);

    await user.click(screen.getByRole("button", { name: "Burette" }));
    // The valve position is named both in the prompt and in the HUD.
    expect(screen.getAllByText(/stopcock: closed/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /open the stopcock/i }));

    // Cracked open, not slammed wide: the first notch is the slow one.
    expect(screen.getAllByText(/stopcock: cracked open/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /turn the stopcock/i })).toBeTruthy();
  });

  it("is not a control before a trial is running, and says why", async () => {
    // Prepared but not titrating: the domain would refuse a delivery, so the
    // valve explains itself instead of turning and doing nothing.
    const state = labStateViewFor(prepared());
    const user = await openLab(state);

    await user.click(screen.getByRole("button", { name: "Burette" }));

    const valve = screen.getByRole("button", { name: /open the stopcock/i });
    expect(valve).toHaveProperty("disabled", true);
    expect(screen.getByText(/start a trial before opening the stopcock/i)).toBeTruthy();
  });
});

describe("a disabled control explains itself", () => {
  it("ties the reason to the control it belongs to", () => {
    const state = labStateViewFor(prepared());

    renderLabPanels({ state, panels: <TitrationControls /> });

    const stopcock = screen.getByRole("button", { name: /open stopcock/i });
    expect(stopcock).toHaveProperty("disabled", true);

    // The reason is real text in the DOM, linked by aria-describedby — not a
    // tooltip that touch users cannot reach.
    const describedBy = stopcock.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy as string);
    expect(reason?.textContent).toMatch(/start a trial before opening the stopcock/i);
  });

  it("explains a delivery with no trial, and completion with no reading", () => {
    const noTrial = labStateViewFor(prepared());
    renderLabPanels({ state: noTrial, panels: <TitrationControls /> });
    expect(screen.getByText(/start a trial before delivering titrant/i)).toBeTruthy();
    cleanup();

    const noReading = labStateViewFor(titrating());
    renderLabPanels({ state: noReading, panels: <TitrationControls /> });
    expect(screen.getByText(/record the final burette reading before completing the trial/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /complete trial/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /open stopcock/i })).toHaveProperty("disabled", false);
  });

  it("explains a read-only attempt once, on the control", () => {
    const state = labStateViewFor(titrating(), { canWrite: false });

    renderLabPanels({ state, panels: <TitrationControls /> });

    expect(screen.getAllByText(/this attempt has been submitted, so the bench is read-only/i).length)
      .toBeGreaterThan(0);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveProperty("disabled", true);
    }
  });
});

describe("the console narrates the experiment", () => {
  it("says what is happening while the action is in flight, then what it did", async () => {
    const user = userEvent.setup();
    const session = titrating();
    const state = labStateViewFor(session);
    let release: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<ReturnType<typeof okOutcome>>((resolve) => {
          release = () =>
            resolve(
              okOutcome(publicStateOf(session), 5, {
                colour: "faint_pink",
              }),
            );
        }),
    );

    renderLabPanels({
      state,
      send,
      panels: (
        <>
          <TitrationControls />
          <ActionConsole />
        </>
      ),
    });

    expect(screen.getByText(/the bench is idle/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /open stopcock/i }));
    await user.click(screen.getAllByRole("button", { name: /0\.10 mL/ })[0]);

    // In flight: the student is told what the laboratory is doing.
    expect(await screen.findByText(/titrant running into the flask/i)).toBeTruthy();

    release?.();
    // Settled: the action is described in chemistry terms, with the colour the
    // server reported.
    await waitFor(() => expect(screen.getByText(/titrant delivered: 0\.10 mL/i)).toBeTruthy());
    // The colour comes from the server response, worded by the console.
    expect(screen.getByText(/the flask is now faint pink/i)).toBeTruthy();
  });

  it("stays silent when the engine refuses, leaving the explanation to the alert", async () => {
    const user = userEvent.setup();
    const session = titrating();
    const state = labStateViewFor(session);
    const send = vi.fn(async () =>
      okOutcome(publicStateOf(session), 4, {
        accepted: false,
        code: "excessive_delivery",
        message: "burette capacity exceeded: refill and repeat the trial",
      }),
    );

    renderLabPanels({
      state,
      send,
      panels: (
        <>
          <TitrationControls />
          <LabNotices initialState={state} />
          <ActionConsole />
        </>
      ),
    });

    await user.click(screen.getByRole("button", { name: /open stopcock/i }));
    await user.click(screen.getAllByRole("button", { name: /1\.00 mL/ })[0]);

    // The engine's own words, once.
    expect(await screen.findByRole("alert")).toHaveProperty("textContent");
    expect(screen.getByRole("alert").textContent).toMatch(/refill and repeat the trial/i);
    expect(screen.queryByText(/titrant delivered/i)).toBeNull();
    expect(screen.getByText(/the bench is idle/i)).toBeTruthy();
  });

  it("never claims a save that failed", async () => {
    const user = userEvent.setup();
    const session = titrating();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => ({
      status: "rejected" as const,
      code: "action_failed",
      message: "The action could not be saved. Check your connection and try again.",
      detail: null,
    }));

    renderLabPanels({
      state,
      send,
      panels: (
        <>
          <TitrationControls />
          <LabNotices initialState={state} />
          <ActionConsole />
        </>
      ),
    });

    await user.click(screen.getByRole("button", { name: /open stopcock/i }));
    await user.click(screen.getAllByRole("button", { name: /1\.00 mL/ })[0]);

    await waitFor(() => expect(screen.getAllByText(/save failed/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/titrant delivered/i)).toBeNull();
    expect(screen.getByRole("button", { name: /reload saved state/i })).toBeTruthy();
  });

  it("reports a reconciled revision instead of the action it could not apply", async () => {
    const user = userEvent.setup();
    const session = titrating();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => ({
      status: "conflict" as const,
      message: "This attempt changed in another session.",
      revision: 9,
      publicState: publicStateOf(session),
    }));

    renderLabPanels({
      state,
      send,
      panels: (
        <>
          <TitrationControls />
          <ActionConsole />
        </>
      ),
    });

    await user.click(screen.getByRole("button", { name: /open stopcock/i }));
    await user.click(screen.getAllByRole("button", { name: /1\.00 mL/ })[0]);

    await waitFor(() => expect(screen.getByText(/reloaded/i)).toBeTruthy());
    expect(screen.getByText(/nothing was overwritten/i)).toBeTruthy();
    expect(screen.queryByText(/titrant delivered/i)).toBeNull();
  });
});
