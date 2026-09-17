import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { LabStateProvider } from "@/components/lab/lab-state-provider";
import type { LabStateView } from "@/application/attempts/lab-state";
import type {
  LabActionDependencies,
  LabActionOutcome,
} from "@/application/attempts/lab-transport";
import type { TitrationPublicState } from "@/domain/simulation/titration/engine";

/**
 * Harness for the component tests.
 *
 * The server actions are injected instead of being called: `send` stands in for
 * `submitLabActionAction` and `loadState` for `getLabStateAction`, so a component
 * test drives the real controller and the real panels without a database. The
 * action files themselves are mocked in each test file (they are `server-only`).
 */
export function renderLabPanels({
  state,
  panels,
  send,
  loadState,
}: {
  state: LabStateView;
  panels: ReactNode;
  send?: LabActionDependencies["apply"] extends never ? never : (input: unknown) => Promise<LabActionOutcome>;
  loadState?: (attemptId: string) => Promise<
    { status: "ok"; state: LabStateView } | { status: "error"; code: string; message: string }
  >;
}) {
  return render(
    <LabStateProvider initialState={state} send={send} loadState={loadState}>
      {panels}
    </LabStateProvider>,
  );
}

/** A successful action outcome, as the transport would return it. */
export function okOutcome(
  publicState: TitrationPublicState,
  revision: number,
  extra: Partial<Extract<LabActionOutcome, { status: "ok" }>> = {},
): LabActionOutcome {
  return {
    status: "ok",
    accepted: true,
    code: null,
    message: null,
    colour: null,
    calculationCorrect: null,
    revision,
    publicState,
    ...extra,
  };
}
