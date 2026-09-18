// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LabHeader } from "@/components/lab/lab-header";
import { ReviewSubmitPanel } from "@/components/lab/review-submit-panel";
import { recordObservation } from "@/domain/simulation/titration/engine";
import { labStateViewFor } from "../helpers/lab-fixture";
import { renderLabPanels } from "../helpers/lab-render";
import {
  concordantStageASession,
  freshSession,
  provisionedFullSession,
  STAGE_A,
} from "../helpers/titration-fixtures";

const { saveReportDraftAction, submitAttemptAction } = vi.hoisted(() => ({
  saveReportDraftAction: vi.fn(),
  submitAttemptAction: vi.fn(),
}));

vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
  saveReportDraftAction,
  submitAttemptAction,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function loadStateFor(state: ReturnType<typeof labStateViewFor>) {
  return () => Promise.resolve({ status: "ok" as const, state });
}

describe("review and submit panel (jsdom)", () => {
  it("shows the checklist with Stage B locked on a fresh attempt", () => {
    const state = labStateViewFor(freshSession());

    renderLabPanels({
      state,
      panels: <ReviewSubmitPanel initialState={state} />,
      loadState: loadStateFor(state),
    });

    expect(screen.getByText("Review & submit")).toBeTruthy();
    expect(screen.getByText("Work remaining")).toBeTruthy();
    const review = screen.getByRole("region", { name: "Review and submit" });
    expect(within(review).getByText("Locked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit attempt" })).toBeTruthy();
  });

  it("shows the server's blockers when submission is refused", async () => {
    const user = userEvent.setup();
    const state = labStateViewFor(freshSession());
    submitAttemptAction.mockResolvedValue({
      status: "blocked",
      blockers: ["Stage A (Standardization of NaOH with KHP): Record 3 trials (0 of 3 recorded)."],
    });

    renderLabPanels({
      state,
      panels: <ReviewSubmitPanel initialState={state} />,
      loadState: loadStateFor(state),
    });

    await user.click(screen.getByRole("button", { name: "Submit attempt" }));
    await waitFor(() => {
      expect(screen.getByText("Not ready to submit yet")).toBeTruthy();
    });
    // The server's verdict renders inside the alert (the checklist above shows
    // the same requirement live, so the query is scoped to the alert).
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/Record 3 trials/)).toBeTruthy();
  });

  it("saves the report draft with the edited sections", async () => {
    const user = userEvent.setup();
    const state = labStateViewFor(concordantStageASession());
    saveReportDraftAction.mockResolvedValue({ status: "ok" });

    renderLabPanels({
      state,
      panels: <ReviewSubmitPanel initialState={state} />,
      loadState: loadStateFor(state),
    });

    await user.type(screen.getByLabelText("Aim"), "Standardise the sodium hydroxide.");
    await user.click(screen.getByRole("button", { name: "Save report draft" }));

    await waitFor(() => {
      expect(screen.getByText("Draft saved.")).toBeTruthy();
    });
    expect(saveReportDraftAction).toHaveBeenCalledWith(
      state.attemptId,
      expect.objectContaining({ aim: "Standardise the sodium hydroxide." }),
    );
  });

  it("marks the finished experiment ready and submits it", async () => {
    const user = userEvent.setup();
    const session = provisionedFullSession();
    expect(recordObservation(session, STAGE_A, "colour_change", "Faint pink persists.").ok).toBe(
      true,
    );
    const state = labStateViewFor(session);
    submitAttemptAction.mockResolvedValue({ status: "ok", alreadySubmitted: false });

    renderLabPanels({
      state,
      panels: <ReviewSubmitPanel initialState={state} />,
      loadState: loadStateFor(state),
    });

    expect(screen.getByText("Ready to submit")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Submit attempt" }));

    await waitFor(() => {
      expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
    });
    expect(submitAttemptAction).toHaveBeenCalledWith(state.attemptId);
    // The editor is gone once the attempt is submitted: nothing left to press.
    expect(screen.queryByRole("button", { name: "Submit attempt" })).toBeNull();
  });

  it("renders a frozen attempt with no action buttons at all", () => {
    const state = labStateViewFor(freshSession(), { canWrite: false });

    renderLabPanels({
      state,
      panels: <ReviewSubmitPanel initialState={state} />,
      loadState: loadStateFor(state),
    });

    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("stage switcher lock (jsdom)", () => {
  it("disables Stage B until Stage A is complete", () => {
    const state = labStateViewFor(freshSession());
    renderLabPanels({
      state,
      panels: <LabHeader initialState={state} />,
      loadState: loadStateFor(state),
    });

    const stageB = screen.getByRole("button", { name: /Stage B/ });
    expect(stageB.hasAttribute("disabled")).toBe(true);
    expect(stageB.textContent).toContain("Locked");
  });

  it("enables Stage B once Stage A is concordant", () => {
    const state = labStateViewFor(concordantStageASession());
    renderLabPanels({
      state,
      panels: <LabHeader initialState={state} />,
      loadState: loadStateFor(state),
    });

    const stageB = screen.getByRole("button", { name: /Stage B/ });
    expect(stageB.hasAttribute("disabled")).toBe(false);
    expect(stageB.textContent).not.toContain("Locked");
  });
});
