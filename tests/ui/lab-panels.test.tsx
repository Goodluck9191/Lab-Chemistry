// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { TrialTable } from "@/components/lab/trial-table";
import { ConcordancePanel } from "@/components/lab/concordance-panel";
import { MeasurementPanel } from "@/components/lab/measurement-panel";
import { ObservationPanel } from "@/components/lab/observation-panel";
import { CalculationPanel } from "@/components/lab/calculation-panel";
import { AutosaveIndicator } from "@/components/lab/autosave-indicator";
import { LabNotices } from "@/components/lab/lab-notices";
import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabPanels } from "../helpers/lab-render";
import {
  addIndicator,
  addTitrant,
  completeTrial,
  readBurette,
  reportMolarity,
  setupApparatus,
  startTrialAction,
  weighAnalyte,
} from "@/domain/simulation/titration/engine";
import {
  STAGE_A,
  concordantStageASession,
  freshSession,
  hiddenTruth,
  overshotStageASession,
  publicStateOf,
  scattershotStageASession,
} from "../helpers/titration-fixtures";

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

function allPanels(state: ReturnType<typeof labStateViewFor>) {
  return (
    <>
      <AutosaveIndicator />
      <LabNotices initialState={state} />
      <MeasurementPanel />
      <ConcordancePanel />
      <TrialTable />
      <ObservationPanel initialState={state} />
      <CalculationPanel initialState={state} />
    </>
  );
}

describe("laboratory data panels (jsdom)", () => {
  it("tabulates the persisted trials, including a trial the engine rejected", () => {
    const session = overshotStageASession("panel-fixture-seed");
    const state = labStateViewFor(session);

    renderLabPanels({ state, panels: allPanels(state) });

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // Header plus one trial.
    expect(rows).toHaveLength(2);
    expect(within(table).getByText("Rejected (overshot)")).toBeTruthy();
    expect(within(table).getByText(/overshot endpoint/i)).toBeTruthy();
    // The explanation sits beside the table, not inside it.
    expect(screen.getByText(/rejected trials stay in the table/i)).toBeTruthy();
  });

  it("shows an empty table with the reason rather than placeholder data", () => {
    const session = freshSession();
    const state = labStateViewFor(session);
    renderLabPanels({ state, panels: allPanels(state) });

    expect(screen.getByText(/no trials have been recorded on this stage yet/i)).toBeTruthy();
    expect(screen.getByText(/no trials yet\. the experiment asks for 3/i)).toBeTruthy();
  });

  it("presents the server's concordance verdict for the stage still in progress", () => {
    const session = scattershotStageASession("panel-concordance-seed");
    const state = labStateViewFor(session);
    const stage = state.publicState.stages[STAGE_A];
    expect(stage.concordance.concordant).toBe(false);

    renderLabPanels({ state, panels: allPanels(state) });

    const panel = within(screen.getByRole("region", { name: /concordance/i }));

    expect(panel.getByText("Not concordant")).toBeTruthy();
    expect(panel.getByText(/do not agree within 0\.005 mol\/L/i)).toBeTruthy();
    expect(panel.getByText("3 / 3 required")).toBeTruthy();
    expect(panel.getByText(new RegExp(`^${stage.concordance.spread} mol/L$`))).toBeTruthy();
    // The average comes from the domain's closest-pair rule, not from React.
    expect(
      panel.getByText(new RegExp(`^${stage.concordance.averageMolarityM} mol/L$`)),
    ).toBeTruthy();
    expect(panel.getByText(/^1, 2, 3$/)).toBeTruthy();
  });

  it("moves the workspace to stage B once stage A is concordant", () => {
    const session = concordantStageASession("panel-advance-seed");
    const state = labStateViewFor(session);

    renderLabPanels({ state, panels: allPanels(state) });

    // The panels follow the stage the server says is unfinished.
    expect(screen.getByText(/no trials recorded yet\. the experiment asks for 3/i)).toBeTruthy();
    expect(screen.getByText(/nothing has been recorded on this stage yet/i)).toBeTruthy();
    expect(screen.queryByText(/mass of khp weighed/i)).toBeNull();
  });

  it("lists recorded measurements and describes flags by code only", () => {
    const session = freshSession();
    setupApparatus(session, STAGE_A, "naoh", 0);
    weighAnalyte(session, STAGE_A, 0.6);
    addIndicator(session, STAGE_A, 3);
    startTrialAction(session, STAGE_A, 1, 0);
    addTitrant(session, STAGE_A, hiddenTruth(session, STAGE_A).observableMl);
    readBurette(session, STAGE_A, hiddenTruth(session, STAGE_A).observableMl);
    completeTrial(session, STAGE_A);
    // Deliberately report a value that cannot agree, producing a flag.
    reportMolarity(session, STAGE_A, 1, 0.05);

    const state = labStateViewFor(session);
    renderLabPanels({ state, panels: allPanels(state) });

    expect(screen.getByText(/mass of khp weighed/i)).toBeTruthy();
    expect(screen.getByText("0.6 g")).toBeTruthy();
    expect(screen.getByText(/trial 1: volume used/i)).toBeTruthy();
    const flags = screen.getAllByText(/reading error/i);
    expect(flags.length).toBeGreaterThan(0);
    // Raw detail strings never reach the DOM.
    expect(document.body.textContent).not.toMatch(/outside the accepted tolerance/);
    expect(document.body.textContent).not.toMatch(/vs observable/);
  });

  it("saves an observation through the protocol and shows the stored value", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () => {
      const next = freshSession();
      const saved = publicStateOf(next);
      saved.observations.push({
        stageKey: STAGE_A,
        fieldKey: "colour_change",
        textValue: "Faint pink that persisted for a minute",
      });
      return okOutcome(saved, 5);
    });

    renderLabPanels({ state, send, panels: allPanels(state) });

    const textarea = screen.getByLabelText(/describe the colour change observed at the endpoint/i);
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(screen.getByRole("button", { name: /save observation/i })).toHaveProperty(
      "disabled",
      true,
    );

    await user.type(textarea, "Faint pink that persisted for a minute");
    expect(screen.getByText(/unsaved changes/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /save observation/i }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      action: {
        type: "record_observation",
        stageKey: STAGE_A,
        fieldKey: "colour_change",
        text: "Faint pink that persisted for a minute",
      },
    });

    // The panel now reflects the value the SERVER returned, and the autosave
    // indicator reports the revision it was stored as.
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("rev 5"));
    expect(within(screen.getByRole("status")).getByText("Saved")).toBeTruthy();
    expect(within(screen.getByRole("status")).queryByText(/saving/i)).toBeNull();
    expect(textarea).toHaveProperty("value", "Faint pink that persisted for a minute");
  });

  it("submits a reported concentration and reports the server's verdict", async () => {
    const user = userEvent.setup();
    const session = scattershotStageASession("panel-calc-seed");
    const state = labStateViewFor(session);
    const send = vi.fn<(input: unknown) => Promise<LabActionOutcome>>(async () =>
      okOutcome(publicStateOf(session), 5, { calculationCorrect: true }),
    );

    renderLabPanels({ state, send, panels: allPanels(state) });

    // One prompt per recorded trial, so the first is trial 1's.
    const field = screen.getAllByLabelText(/your value/i)[0];
    await user.type(field, "0.1995");
    await user.click(screen.getAllByRole("button", { name: /submit value/i })[0]);

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      action: {
        type: "report_molarity",
        stageKey: STAGE_A,
        trialNumber: 1,
        studentMolarityM: 0.1995,
      },
    });
    // Feedback states the verdict without ever naming the expected value.
    await waitFor(() =>
      expect(screen.getAllByText(/agrees with the simulation/i).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/0\.1995 is the expected/i)).toBeNull();
  });

  it("says plainly which calculation it cannot mark", () => {
    const session = scattershotStageASession("panel-ungraded-seed");
    const state = labStateViewFor(session);
    renderLabPanels({ state, panels: allPanels(state) });

    expect(screen.getByText(/worked out by hand \(not marked\)/i)).toBeTruthy();
    expect(screen.getByText(/no submission action for these intermediate steps yet/i)).toBeTruthy();
    expect(screen.getByText(/molar mass of khp/i)).toBeTruthy();
  });

  it("reports autosave status from the server response only", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => okOutcome(publicStateOf(session), 7));

    renderLabPanels({ state, send, panels: allPanels(state) });

    expect(screen.getByText("Not saved yet")).toBeTruthy();

    // A UI change alone must never claim a save.
    await user.click(screen.getByLabelText(/describe the colour change/i));
    expect(screen.queryByText("Saved")).toBeNull();

    await user.type(screen.getByLabelText(/describe the colour change/i), "Pink");
    await user.click(screen.getByRole("button", { name: /save observation/i }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("rev 7");
  });

  it("shows a save failure with a way to reload the saved state", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => ({
      status: "rejected" as const,
      code: "action_failed",
      message: "The action could not be saved. Check your connection and try again.",
      // Development runs surface the driver's own message so a storage failure
      // can be diagnosed; production sends null.
      detail: "Failed to sync trial rows: permission denied for table experiment_trials",
    }));
    const loadState = vi.fn(async () => ({ status: "ok" as const, state }));

    renderLabPanels({ state, send, loadState, panels: allPanels(state) });

    await user.type(screen.getByLabelText(/describe the colour change/i), "Pink");
    await user.click(screen.getByRole("button", { name: /save observation/i }));

    // ONE alert, and it says what actually happened — the failure used to be
    // reported twice, with the cause in neither.
    // The autosave indicator labels the state too, so the alert is asserted by
    // its wording rather than by title alone.
    await waitFor(() =>
      expect(screen.getAllByText("Save failed").length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/could not be saved/i)).toBeTruthy();
    expect(screen.getByText(/last state the server confirmed/i)).toBeTruthy();
    expect(screen.getByText(/permission denied for table experiment_trials/i)).toBeTruthy();
    expect(screen.queryByText("The action was not saved")).toBeNull();
    await user.click(screen.getByRole("button", { name: /reload saved state/i }));
    await waitFor(() => expect(loadState).toHaveBeenCalledTimes(1));
  });

  it("reconciles a stale revision instead of overwriting it", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    const state = labStateViewFor(session);
    const fresh = concordantStageASession("panel-conflict-seed");
    const send = vi.fn(async () => ({
      status: "conflict" as const,
      message:
        "This attempt changed in another session. The laboratory has been refreshed with the latest saved state — check your readings and repeat the last action.",
      revision: 11,
      publicState: publicStateOf(fresh),
    }));

    renderLabPanels({ state, send, panels: allPanels(state) });

    await user.type(screen.getByLabelText(/describe the colour change/i), "Pink");
    await user.click(screen.getByRole("button", { name: /save observation/i }));

    await waitFor(() => expect(screen.getByText("Saved state refreshed")).toBeTruthy());
    // The authoritative state is the one the server sent, not the local draft.
    await waitFor(() => expect(screen.getByText("Concordant")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("rev 11");
  });

  it("explains a protocol mismatch and asks for a reload", async () => {
    const user = userEvent.setup();
    const session = freshSession();
    const state = labStateViewFor(session);
    const send = vi.fn(async () => ({
      status: "rejected" as const,
      code: "protocol_mismatch",
      message: "This page is out of date with the simulation protocol. Reload the laboratory to continue.",
      detail: null,
    }));

    renderLabPanels({ state, send, panels: allPanels(state) });
    await user.type(screen.getByLabelText(/describe the colour change/i), "Pink");
    await user.click(screen.getByRole("button", { name: /save observation/i }));

    await waitFor(() => expect(screen.getByText("Reload required")).toBeTruthy());
    expect(screen.getByText(/out of date with the simulation protocol/i)).toBeTruthy();
  });

  it("shows catalog coverage notices without inventing chemistry", () => {
    const session = freshSession();
    const notice =
      "The public experiment catalog does not list these reagents, which the simulation for this experiment uses: hcl.";
    const state = labStateViewFor(session, { notices: [notice] });

    renderLabPanels({ state, panels: allPanels(state) });
    expect(screen.getByText("Configuration coverage")).toBeTruthy();
    expect(screen.getByText(notice)).toBeTruthy();
  });

  it("never renders a hidden value anywhere in the data panels", () => {
    const session = concordantStageASession("panel-hidden-seed");
    const truth = hiddenTruth(session, STAGE_A);
    const state = labStateViewFor(session);

    renderLabPanels({ state, panels: allPanels(state) });

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("panel-hidden-seed");
    expect(text).not.toContain(truth.trueTitrantMolarityM.toString());
    expect(text).not.toContain(String(truth.analyteMoles));
    expect(text).not.toContain("equivalenceMl");
    expect(text).not.toContain("observableMl");
  });
});
