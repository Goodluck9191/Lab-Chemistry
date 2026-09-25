// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionForm } from "@/app/(student)/student/reports/[attemptId]/question-form";
import { renderLabPanels } from "../helpers/lab-render";
import { labStateViewFor } from "../helpers/lab-fixture";
import { ReviewSubmitPanel } from "@/components/lab/review-submit-panel";
import { freshSession } from "../helpers/titration-fixtures";
import { saveReportAnswersAction } from "@/application/attempts/actions";

vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
  saveReportDraftAction: vi.fn(),
  submitAttemptAction: vi.fn(),
  saveReportAnswersAction: vi.fn(),
}));

vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);

const QUESTIONS = [
  { key: "q_aim", prompt: "What is the aim of the experiment?", answer: "" },
  { key: "q_water_volume", prompt: "Why does the water volume not matter?", answer: "Moles unchanged." },
];

describe("report questions form (jsdom)", () => {
  it("saves answers through the server action while the attempt is open", async () => {
    const user = userEvent.setup();
    vi.mocked(saveReportAnswersAction).mockResolvedValue({ status: "ok" });
    const state = labStateViewFor(freshSession("report-questions-form"));
    renderLabPanels({
      state,
      panels: (
        <QuestionForm attemptId={state.attemptId} questions={QUESTIONS} errorSources="" canWrite />
      ),
    });

    await user.type(screen.getByLabelText(/Q1\. What is the aim/i), "Determine the concentration.");
    await user.click(screen.getByRole("button", { name: /save answers/i }));
    expect(saveReportAnswersAction).toHaveBeenCalledWith(
      state.attemptId,
      expect.objectContaining({ q_aim: "Determine the concentration." }),
    );
  });

  it("is read-only once the attempt is submitted", async () => {
    const state = labStateViewFor(freshSession("report-questions-locked"));
    renderLabPanels({
      state,
      panels: (
        <QuestionForm attemptId={state.attemptId} questions={QUESTIONS} errorSources="" canWrite={false} />
      ),
    });
    expect(screen.getByText(/read-only/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save answers/i })).toBeNull();
  });
});

describe("lab to report transition (jsdom)", () => {
  it("links the review panel to the per-attempt report", async () => {
    const state = labStateViewFor(freshSession("report-continue-link"));
    renderLabPanels({ state, panels: <ReviewSubmitPanel initialState={state} /> });
    const link = screen.getByRole("link", { name: /continue to report/i });
    expect(link.getAttribute("href")).toBe(`/student/reports/${state.attemptId}`);
  });
});
