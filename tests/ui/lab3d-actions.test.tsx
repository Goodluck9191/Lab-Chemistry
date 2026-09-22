// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { labStateViewFor } from "../helpers/lab-fixture";
import { okOutcome, renderLabWorld } from "../helpers/lab-render";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import {
  toPublicJSON,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import {
  STAGE_A,
  STAGE_B,
  freshSession,
  provisionStageA,
  provisionStageB,
  concordantStageASession,
  overshotStageASession,
} from "../helpers/titration-fixtures";

// The controller imports the server actions at module scope; component tests
// inject their own sender, so the real ones must never be loaded here.
vi.mock("@/application/attempts/actions", () => ({
  submitLabActionAction: vi.fn(),
  getLabStateAction: vi.fn(),
}));

vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);

/**
 * A sender that runs the REAL dispatch against a live session, so the 3D
 * actions below drive genuine state evolution (weigh twice, rinse twice…)
 * exactly like the server would — minus the database.
 */
function liveSend(session: TitrationSession) {
  let revision = 4;
  return vi.fn(async (input: unknown): Promise<LabActionOutcome> => {
    const envelope = input as { action: TitrationProtocolAction };
    const outcome = dispatchTitrationAction(session, "exp-02", envelope.action);
    if (!outcome.accepted) {
      return {
        status: "ok",
        accepted: false,
        code: outcome.code,
        message: outcome.message,
        colour: null,
        calculationCorrect: null,
        revision,
        publicState: toPublicJSON(session),
      };
    }
    revision += 1;
    return okOutcome(toPublicJSON(session), revision, {
      calculationCorrect: outcome.calculationCorrect ?? null,
    });
  });
}

function actionsOf(send: ReturnType<typeof liveSend>) {
  return send.mock.calls.map((call) => (call[0] as { action: { type: string } }).action.type);
}

async function show3D(state: ReturnType<typeof labStateViewFor>, send: ReturnType<typeof liveSend>) {
  const user = userEvent.setup();
  renderLabWorld({ state, send });
  // E opens the contextual prompt, which is where the apparatus actions live
  // now that there is no permanent toolbar to click.
  await user.keyboard("{e}");
  expect(screen.getByLabelText("3D contextual actions")).toBeTruthy();
  return user;
}

describe("Experiment 2 from the 3D laboratory (jsdom)", () => {
  it("runs Part I and Part II preparation through 3D actions", async () => {
    const session = freshSession("lab3d-actions-prep");
    const state = labStateViewFor(session);
    const send = liveSend(session);
    const user = await show3D(state, send);

    // Part I: stock bottle -> prep flask section.
    await user.click(screen.getByRole("button", { name: "Prep flask" }));
    await user.type(screen.getByLabelText(/stock volume measured/i), "10");
    await user.click(screen.getByRole("button", { name: /record stock/i }));
    await waitFor(() => expect(actionsOf(send)).toContain("measure_naoh_stock"));
    await user.click(screen.getByRole("button", { name: /add distilled water/i }));
    await user.click(screen.getByRole("button", { name: /stopper and swirl/i }));

    // Burette: rinse, portion, condition, fill, bubble.
    await user.click(screen.getByRole("button", { name: "Burette" }));
    await user.click(screen.getByRole("button", { name: /rinse with tap water/i }));
    await user.click(screen.getByRole("button", { name: /obtain naoh portion/i }));
    await user.click(screen.getByRole("button", { name: /condition \(0\/3\)/i }));
    await user.click(await screen.findByRole("button", { name: /condition \(1\/3\)/i }));
    await user.click(await screen.findByRole("button", { name: /condition \(2\/3\)/i }));
    await user.type(screen.getByLabelText("Initial reading"), "0");
    await user.click(screen.getByRole("button", { name: /fill burette/i }));
    await waitFor(() => expect(actionsOf(send)).toContain("setup_apparatus"));
    await user.click(screen.getByRole("button", { name: /expel air bubble/i }));

    // Balance + beaker: weighing by difference, dissolve, transfer, rinses.
    await user.click(screen.getByRole("button", { name: "Balance" }));
    await user.type(screen.getByLabelText(/empty beaker/i), "52.34");
    await user.click(screen.getByRole("button", { name: /record weighing/i }));
    await waitFor(() => expect(actionsOf(send).filter((type) => type === "weigh_beaker")).toHaveLength(1));
    await user.type(screen.getByLabelText(/beaker \+ khp/i), "52.94");
    await user.click(screen.getByRole("button", { name: /record weighing/i }));
    await user.click(screen.getByRole("button", { name: /dissolve khp/i }));
    await user.click(screen.getByRole("button", { name: /transfer to flask/i }));
    await user.click(screen.getByRole("button", { name: /rinse beaker \(0\/2\)/i }));
    await waitFor(() =>
      expect(send.mock.calls.filter((call) => (call[0] as { action: { type: string } }).action.type === "rinse_beaker")).toHaveLength(1),
    );

    // Indicator via the reagent shelf.
    await user.click(screen.getByRole("button", { name: "Reagents" }));
    await user.click(screen.getByRole("button", { name: /phenolphthalein/i }));
    await user.click(screen.getByRole("button", { name: /add drops/i }));

    // Flask placement.
    await user.click(screen.getByRole("button", { name: "Flask" }));
    await user.click(screen.getByRole("button", { name: /place under burette/i }));

    await waitFor(() => expect(actionsOf(send)).toContain("place_flask"));
    expect(actionsOf(send)).toEqual([
      "measure_naoh_stock",
      "dilute_naoh_solution",
      "mix_naoh_solution",
      "rinse_burette",
      "obtain_naoh_portion",
      "condition_burette",
      "condition_burette",
      "condition_burette",
      "setup_apparatus",
      "clear_air_bubble",
      "weigh_beaker",
      "weigh_beaker",
      "dissolve_khp",
      "transfer_solution",
      "rinse_beaker",
      "add_indicator",
      "place_flask",
    ]);
  }, 30_000);

  it("starts, reads, completes, reports and discards a trial from the 3D view", async () => {
    const session = freshSession("lab3d-actions-trial");
    provisionStageA(session);
    const state = labStateViewFor(session);
    const send = liveSend(session);
    const user = await show3D(state, send);

    await user.click(screen.getByRole("button", { name: "Burette" }));
    await user.type(screen.getByLabelText(/trial 1 initial/i), "0");
    await user.click(screen.getByRole("button", { name: /start trial 1/i }));
    await waitFor(() => expect(actionsOf(send)).toContain("start_trial"));

    const region = screen.getByLabelText("3D contextual actions");
    await user.click(within(region).getByRole("button", { name: /faint pink/i }));
    await user.click(within(region).getByRole("button", { name: /^record$/i }));
    await user.type(within(region).getByLabelText(/final reading/i), "12.5");
    await user.click(within(region).getByRole("button", { name: /record final/i }));
    await user.click(within(region).getByRole("button", { name: /complete trial/i }));
    await waitFor(() => expect(actionsOf(send)).toContain("complete_trial"));

    await user.type(within(region).getByLabelText(/trial 1 \(mol\/l\)/i), "0.2");
    await user.click(within(region).getByRole("button", { name: /submit trial 1/i }));
    await waitFor(() => expect(actionsOf(send)).toContain("report_molarity"));

    await user.click(screen.getByRole("button", { name: "Flask" }));
    await user.click(screen.getByRole("button", { name: /discard into waste/i }));
    await waitFor(() => expect(actionsOf(send)).toContain("discard_to_waste"));

    expect(actionsOf(send)).toEqual([
      "start_trial",
      "observe_endpoint",
      "read_burette",
      "complete_trial",
      "report_molarity",
      "discard_to_waste",
    ]);
  }, 30_000);

  it("measures the HCl aliquot from the 3D view on Part III", async () => {
    const session = freshSession("lab3d-actions-hcl");
    provisionStageA(session);
    // Finish Stage A so Part III unlocks: three concordant trials via dispatch.
    const endpoint = 12.5;
    for (let trial = 1; trial <= 3; trial += 1) {
      const ok = (action: TitrationProtocolAction) => dispatchTitrationAction(session, "exp-02", action);
      ok({ type: "start_trial", stageKey: STAGE_A, trialNumber: trial, initialReadingMl: 0 });
      ok({ type: "add_titrant", stageKey: STAGE_A, volumeMl: endpoint });
      ok({ type: "read_burette", stageKey: STAGE_A, observedFinalMl: endpoint });
      ok({ type: "complete_trial", stageKey: STAGE_A });
      ok({ type: "report_molarity", stageKey: STAGE_A, trialNumber: trial, studentMolarityM: 0.2 });
      ok({ type: "discard_to_waste", stageKey: STAGE_A });
    }
    provisionStageB(session);
    const state = labStateViewFor(session);
    const send = liveSend(session);
    const user = await show3D(state, send);

    await user.click(screen.getByRole("button", { name: "Cylinder" }));
    await user.type(screen.getByLabelText(/aliquot delivered/i), "25");
    await user.click(screen.getByRole("button", { name: /record aliquot/i }));
    await waitFor(() => expect(actionsOf(send)).toContain("pipette_analyte"));
    const payload = (send.mock.calls[0][0] as { action: Record<string, unknown> }).action;
    expect(payload).toMatchObject({ type: "pipette_analyte", stageKey: STAGE_B, observedVolumeMl: 25 });
  }, 30_000);

  it("shows trial progress, concordance and rejected trials in the 3D strip", async () => {
    const state = labStateViewFor(overshotStageASession("lab3d-actions-strip"));
    renderLabWorld({ state });
    const strip = screen.getByRole("status", { name: /trial progress/i });
    expect(within(strip).getByText(/0\/3 recorded/i)).toBeTruthy();
    expect(within(strip).getByText(/rejected: 1 \(excluded\)/i)).toBeTruthy();

    cleanup();
    const concordant = labStateViewFor(concordantStageASession("lab3d-actions-conc"));
    renderLabWorld({ state: concordant });
    const strip2 = screen.getByRole("status", { name: /trial progress/i });
    // Stage A is finished, so the strip follows Stage B: nothing recorded yet.
    expect(within(strip2).getByText(/0\/3 recorded/i)).toBeTruthy();
    expect(within(strip2).getByText(/not started/i)).toBeTruthy();
  }, 30_000);
});
