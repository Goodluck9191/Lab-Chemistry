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
import type { AliquotStage } from "./aliquot-stage";
import {
  nextStopcockAngle,
  stopcockIsOpen,
  stopcockPositionFor,
  type StopcockPosition,
} from "./3d/simulation/stopcock";
import type { CarryKind } from "./3d/interactions/carry";
import { NO_ROTATION, rotateBy, type HeldRotation } from "./3d/simulation/keymap";
import type { PhysicalSelectionKey } from "./3d/simulation/apparatus-state";
import type { BenchPoint } from "./3d/simulation/spatial";

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
  /**
   * Turn the stopcock on one notch. The valve has intermediate openings (§12),
   * so this steps through them and wraps back to closed — the accessible
   * equivalent of turning the handle by hand.
   */
  toggleStopcock: (stageKey: string) => void;
  /** Current handle angle in degrees for a stage; 0 when shut. */
  stopcockAngleForStage: (stageKey: string) => number;
  /** Set the handle angle directly — what the drag on the 3D valve reports. */
  setStopcockAngleForStage: (stageKey: string, angleDeg: number) => void;
  /**
   * Where the vessels physically stand. UI-only bench positions, never
   * chemistry: they decide whether the pour lands in the flask, and nothing
   * else. The authoritative placement is still the server's `place_flask`.
   */
  flaskPos: BenchPoint | null;
  setFlaskPos: (point: BenchPoint | null) => void;
  beakerPos: BenchPoint | null;
  setBeakerPos: (point: BenchPoint | null) => void;
  /** Close inspection of the meniscus with the scale enlarged. */
  readingMode: boolean;
  setReadingMode: (reading: boolean) => void;
  /** Visual stirring with the glass rod; the dissolution itself is recorded. */
  stirring: boolean;
  setStirring: (stirring: boolean) => void;
  /** Which notch the valve is sitting on, for the prompt and the HUD. */
  stopcockPositionForStage: (stageKey: string) => StopcockPosition;
  /** The apparatus the crosshair is on right now, if any. */
  lookedAtKey: PhysicalSelectionKey;
  setLookedAtKey: (key: PhysicalSelectionKey) => void;
  /** Vessel physically in the student's hand, if any. */
  carried: CarryKind | null;
  setCarried: (kind: CarryKind | null) => void;
  /** How the carried object is turned in the hand (visual only). */
  carriedRotation: HeldRotation;
  rotateCarried: (direction: 1 | -1) => void;
  /** Whether the contextual action card is open. */
  promptOpen: boolean;
  setPromptOpen: (open: boolean) => void;
  /** Immersive first-person walking versus free orbit inspection. */
  walkMode: boolean;
  setWalkMode: (walk: boolean) => void;
  /** Whether the browser has captured the pointer for mouse-look. */
  pointerLocked: boolean;
  setPointerLocked: (locked: boolean) => void;
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
  /**
   * 3D camera focus request (immersive keyboard "F" support). UI-only: the
   * scene applies the requested focus target and clears nothing — a new
   * request supersedes the previous one via its id.
   */
  focusRequest: { key: "burette" | "flask" | "balance" | "cylinder" | null; id: number };
  requestFocus: (key: "burette" | "flask" | "balance" | "cylinder" | null) => void;
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
  // One valve position, remembered per stage: a student who steps away from the
  // burette leaves the tap where they left it.
  const [stopcockAngles, setStopcockAngles] = useState<Record<string, number>>({});
  const [currentStopcockStage, setCurrentStopcockStage] = useState<string | null>(null);
  const [lookedAtKey, setLookedAtKey] = useState<PhysicalSelectionKey>(null);
  const [carried, setCarried] = useState<CarryKind | null>(null);
  const [carriedRotation, setCarriedRotation] = useState<HeldRotation>(NO_ROTATION);
  const [promptOpen, setPromptOpen] = useState(false);
  const [walkMode, setWalkMode] = useState(true);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [flaskPos, setFlaskPos] = useState<BenchPoint | null>(null);
  const [beakerPos, setBeakerPos] = useState<BenchPoint | null>(null);
  const [readingMode, setReadingMode] = useState(false);
  const [stirring, setStirring] = useState(false);
  const [swirl, setSwirl] = useState(false);
  const [selectedReagentKey, setSelectedReagentKey] = useState<string | null>(null);
  const [selectedApparatusKey, setSelectedApparatusKey] = useState<string | null>(null);
  const [aliquotStage, setAliquotStage] = useState<AliquotStage>("resting");
  const [fillerAttached, setFillerAttached] = useState(false);
  const [focusedApparatus, setFocusedApparatus] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    key: "burette" | "flask" | "balance" | "cylinder" | null;
    id: number;
  }>({ key: null, id: 0 });
  const requestFocus = useCallback(
    (key: "burette" | "flask" | "balance" | "cylinder" | null) =>
      setFocusRequest((current) => ({ key, id: current.id + 1 })),
    [],
  );

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

  const toggleStopcock = useCallback((stageKey: string) => {
    setCurrentStopcockStage(stageKey);
    setStopcockAngles((current) => ({
      ...current,
      [stageKey]: nextStopcockAngle(current[stageKey] ?? 0),
    }));
  }, []);

  const stopcockAngleForStage = useCallback(
    (stageKey: string) => stopcockAngles[stageKey] ?? 0,
    [stopcockAngles],
  );

  const stopcockPositionForStage = useCallback(
    (stageKey: string) => stopcockPositionFor(stopcockAngles[stageKey] ?? 0),
    [stopcockAngles],
  );

  const setStopcockAngleForStage = useCallback((stageKey: string, angleDeg: number) => {
    setCurrentStopcockStage(stageKey);
    setStopcockAngles((current) => ({ ...current, [stageKey]: angleDeg }));
  }, []);

  const rotateCarried = useCallback((direction: 1 | -1) => {
    setCarriedRotation((current) => rotateBy(current, direction * (Math.PI / 12)));
    // Rotation belongs to whatever is in the hand; letting go re-homes it.
  }, []);

  // A valve that is open on one stage closes the previous one: the student has
  // exactly one open tap, matching the single physical burette on the bench.
  const stopcockOpenForStage =
    currentStopcockStage !== null && stopcockIsOpen(stopcockAngles[currentStopcockStage] ?? 0)
      ? currentStopcockStage
      : null;

  const uiValue: LabUiContextValue = {
    activeStageKey,
    setActiveStageKey: setSelectedStageKey,
    stopcockOpenForStage,
    toggleStopcock,
    stopcockAngleForStage,
    setStopcockAngleForStage,
    stopcockPositionForStage,
    flaskPos,
    setFlaskPos,
    beakerPos,
    setBeakerPos,
    readingMode,
    setReadingMode,
    stirring,
    setStirring,
    lookedAtKey,
    setLookedAtKey,
    carried,
    setCarried: (kind) => {
      setCarried(kind);
      // A new object arrives in the hand at its natural orientation.
      setCarriedRotation(NO_ROTATION);
    },
    carriedRotation,
    rotateCarried,
    promptOpen,
    setPromptOpen,
    walkMode,
    setWalkMode,
    pointerLocked,
    setPointerLocked,
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
    focusRequest,
    requestFocus,
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
