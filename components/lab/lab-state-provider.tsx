"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { LabStateView } from "@/application/attempts/lab-state";
import type { LabActionOutcome } from "@/application/attempts/lab-transport";
import {
  useLabActionController,
  type LabActionSender,
  type LabControllerState,
  type LabStateLoader,
} from "./lab-action-controller";
import { buildLabViewModel, type LabViewModel } from "./view-model";
import type { AliquotStage } from "./svg/graduated-cylinder-svg";

/**
 * TWO kinds of state, deliberately kept apart (§29):
 *
 *   SERVER-AUTHORITATIVE (this file's `LabServerContext`): the engine's public
 *   state and its autosave revision. Only `perform()` may change it, and only
 *   with what the server returned.
 *
 *   UI-ONLY (`LabUiContext`): which tab is open, which apparatus is highlighted,
 *   whether the stopcock is turned, whether the flask is being swirled, how far
 *   the guided aliquot transfer has got, and the half-typed text in the inputs.
 *   None of it is ever treated as a simulation result, and none of it survives a
 *   reload — because it does not need to.
 *
 * The view model is derived, memoised on the revision, so a hover or a tab change
 * cannot re-render the bench.
 */

export interface LabServerContextValue {
  attemptId: string;
  canWrite: boolean;
  state: LabControllerState;
  pending: boolean;
  saveStatus: LabControllerState["saveStatus"];
  perform: (action: { type: string } & Record<string, unknown>) => Promise<LabActionOutcome | null>;
  refresh: () => Promise<boolean>;
  clearNotice: () => void;
}

export interface LabUiContextValue {
  activeStageKey: string;
  setActiveStageKey: (key: string) => void;
  /** Stage whose stopcock is currently open, or null. */
  stopcockOpenForStage: string | null;
  toggleStopcock: (stageKey: string) => void;
  swirl: boolean;
  setSwirl: Dispatch<SetStateAction<boolean>>;
  selectedReagentKey: string | null;
  setSelectedReagentKey: (key: string | null) => void;
  selectedApparatusKey: string | null;
  setSelectedApparatusKey: (key: string | null) => void;
  /**
   * Progress of the guided aliquot transfer (measure into the ware, then deliver
   * into the flask). UI-ONLY: it gates the guided steps in the panel, but the
   * volume the server records is still the reading the student enters.
   */
  aliquotStage: AliquotStage;
  setAliquotStage: (stage: AliquotStage) => void;
  /**
   * Whether the pipette filler is attached. UI-ONLY, and only meaningful when
   * the configuration names a pipette as the aliquot vessel — a measuring
   * cylinder has no filler, and the panel does not offer one.
   */
  fillerAttached: boolean;
  setFillerAttached: (attached: boolean) => void;
  /** Apparatus shown enlarged in the focus overlay, or null. UI-only. */
  focusedApparatus: string | null;
  setFocusedApparatus: (key: string | null) => void;
}

const LabServerContext = createContext<LabServerContextValue | null>(null);
const LabUiContext = createContext<LabUiContextValue | null>(null);
const LabViewModelContext = createContext<LabViewModel | null>(null);

export function LabStateProvider({
  initialState,
  send,
  loadState,
  children,
}: {
  initialState: LabStateView;
  send?: LabActionSender;
  loadState?: LabStateLoader;
  children: ReactNode;
}) {
  const controller = useLabActionController({
    attemptId: initialState.attemptId,
    revision: initialState.revision,
    publicState: initialState.publicState,
    send,
    loadState,
  });

  // The stage the student is working in, unless they picked one: the first stage
  // the server does NOT yet call concordant. Finishing the required number of
  // trials is not enough to move on — the reported values still have to agree,
  // which is exactly what the concordance panel is for.
  const derivedStageKey =
    initialState.config.stages.find(
      (stage) => !initialState.publicState.stages[stage.key]?.concordance.concordant,
    )?.key ??
    initialState.config.stages[initialState.config.stages.length - 1]?.key ??
    "";

  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [stopcockOpenForStage, setStopcockOpenForStage] = useState<string | null>(null);
  const [swirl, setSwirl] = useState(false);
  const [selectedReagentKey, setSelectedReagentKey] = useState<string | null>(null);
  const [selectedApparatusKey, setSelectedApparatusKey] = useState<string | null>(null);
  const [aliquotStage, setAliquotStage] = useState<AliquotStage>("resting");
  const [fillerAttached, setFillerAttached] = useState(false);
  const [focusedApparatus, setFocusedApparatus] = useState<string | null>(null);

  const activeStageKey = selectedStageKey ?? derivedStageKey;

  const viewModel = useMemo(
    () =>
      buildLabViewModel({
        config: initialState.config,
        publicState: controller.state.publicState,
        chemicalLabels: initialState.chemicalLabels,
        apparatusLabels: initialState.apparatusLabels,
        selectedStageKey: activeStageKey,
        canWrite: initialState.canWrite,
      }),
    [
      initialState.config,
      initialState.chemicalLabels,
      initialState.apparatusLabels,
      initialState.canWrite,
      controller.state.publicState,
      activeStageKey,
    ],
  );

  const serverValue: LabServerContextValue = {
    attemptId: initialState.attemptId,
    canWrite: initialState.canWrite,
    state: controller.state,
    pending: controller.pending,
    saveStatus: controller.state.saveStatus,
    perform: controller.perform,
    refresh: controller.refresh,
    clearNotice: controller.clearNotice,
  };

  // Reagent and apparatus selection are mutually exclusive so the LAST thing the
  // student touches is what the action panel shows. Without this, selecting a
  // reagent and then activating the flask would leave the panel describing the
  // reagent, which reads as the click having done nothing.
  const selectReagent = useCallback((key: string | null) => {
    setSelectedReagentKey(key);
    if (key !== null) setSelectedApparatusKey(null);
  }, []);

  const selectApparatus = useCallback((key: string | null) => {
    setSelectedApparatusKey(key);
    if (key !== null) setSelectedReagentKey(null);
  }, []);

  const uiValue: LabUiContextValue = {
    activeStageKey,
    setActiveStageKey: setSelectedStageKey,
    stopcockOpenForStage,
    toggleStopcock: (stageKey) =>
      setStopcockOpenForStage((current) => (current === stageKey ? null : stageKey)),
    swirl,
    setSwirl,
    selectedReagentKey,
    setSelectedReagentKey: selectReagent,
    selectedApparatusKey,
    setSelectedApparatusKey: selectApparatus,
    aliquotStage,
    setAliquotStage,
    fillerAttached,
    setFillerAttached,
    focusedApparatus,
    setFocusedApparatus,
  };

  return (
    <LabServerContext.Provider value={serverValue}>
      <LabUiContext.Provider value={uiValue}>
        <LabViewModelContext.Provider value={viewModel}>{children}</LabViewModelContext.Provider>
      </LabUiContext.Provider>
    </LabServerContext.Provider>
  );
}

export function useLabServer(): LabServerContextValue {
  const value = useContext(LabServerContext);
  if (!value) throw new Error("useLabServer must be used inside <LabStateProvider>");
  return value;
}

export function useLabUi(): LabUiContextValue {
  const value = useContext(LabUiContext);
  if (!value) throw new Error("useLabUi must be used inside <LabStateProvider>");
  return value;
}

export function useLabViewModel(): LabViewModel {
  const value = useContext(LabViewModelContext);
  if (!value) throw new Error("useLabViewModel must be used inside <LabStateProvider>");
  return value;
}

/** Convenience: the active stage view, which most panels render from. */
export function useActiveStage() {
  const model = useLabViewModel();
  return (
    model.stages.find((stage) => stage.key === model.activeStageKey) ?? model.stages[0] ?? null
  );
}
