"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { LabStateView } from "@/application/attempts/lab-state";
import { LabBench3D } from "./LabBench3D";
import { ProcedurePanel } from "./procedure-panel";
import { ActionPanel } from "./action-panel";
import { TrialTable } from "./trial-table";
import { ConcordancePanel } from "./concordance-panel";
import { MeasurementPanel } from "./measurement-panel";
import { ObservationPanel } from "./observation-panel";
import { CalculationPanel } from "./calculation-panel";
import { ReviewSubmitPanel } from "./review-submit-panel";
import { useActiveStage, useLabServer, useLabUi, useLabViewModel } from "./lab-state-provider";
import { LabHud } from "./3d/ui/LabHud";
import { ContextPrompt } from "./3d/ui/ContextPrompt";
import { StepCard } from "./3d/ui/StepCard";
import { HelpOverlay } from "./3d/ui/HelpOverlay";
import { RecorderOverlay } from "./3d/ui/RecorderOverlay";
import { ReadingOverlay } from "./3d/ReadingOverlay";
import { holdKindFor, holdKindForReagent, canCarry, holdVerbFor } from "./3d/interactions/carry";
import { commandForCode, isTextEntryTarget } from "./3d/simulation/keymap";
import { cn } from "@/lib/utils";

/**
 * The immersive full-screen 3D laboratory (§3–§6, §32, §40).
 *
 * The world owns the viewport. Everything else is an overlay that can be put
 * away: a four-corner HUD, a crosshair, the contextual prompt, and drawers for
 * the procedure, the full action list and the results. Nothing permanent sits
 * between the student and the bench, and no chemistry lives here — the drawers
 * host the SAME panels as before, driven by the same protocol.
 *
 * The keyboard map is one table (`keymap.ts`) shared with the prompt, so the
 * keys advertised on screen are the keys that work.
 */
export function ImmersiveLab({ initialState }: { initialState: LabStateView }) {
  const [drawer, setDrawer] = useState<"procedure" | "results" | null>(null);
  const stage = useActiveStage();
  const model = useLabViewModel();
  const { canWrite, pending } = useLabServer();
  const {
    selectedApparatusKey,
    selectedReagentKey,
    setSelectedApparatusKey,
    setSelectedReagentKey,
    requestFocus,
    lookedAtKey,
    carried,
    setCarried,
    rotateCarried,
    tiltCarried,
    promptOpen,
    setPromptOpen,
    walkMode,
    pointerLocked,
    readingMode,
    setReadingMode,
    helpOpen,
    setHelpOpen,
    accessibilityOpen,
    setAccessibilityOpen,
    recorder,
    setRecorder,
  } = useLabUi();

  const partLabel = !model.solution.ready
    ? "Part I — NaOH preparation"
    : stage
      ? `${stage.index === 0 ? "Part II" : `Part ${stage.index + 1}`} — ${stage.title}`
      : "";

  const markReagent = stage?.indicator.key ?? null;

  /** What E acts on right now: what you selected, else what you are looking at. */
  const subjectKey = selectedReagentKey ? "reagent_bottle" : (selectedApparatusKey ?? lookedAtKey);
  // Selecting a reagent names a chemical; whether it is something you can lift
  // is a property of the laboratory, not of the selection key.
  const subjectHoldKind = selectedReagentKey
    ? holdKindForReagent(selectedReagentKey, markReagent)
    : holdKindFor(subjectKey);
  const verb = holdVerbFor(subjectKey, carried, subjectHoldKind);
  const carrying = canCarry({ canWrite, pending });

  /** The reagent list the prompt offers: enough to reach every reagent action. */
  const reagents = stage
    ? [
        ...(initialState.config.solutionDilution
          ? [
              {
                key: initialState.config.solutionDilution.stockKey,
                label: `${initialState.config.solutionDilution.stockMolarityM} M stock`,
              },
            ]
          : []),
        {
          key: stage.titrantKey,
          label: initialState.chemicalLabels[stage.titrantKey] ?? stage.titrantKey,
        },
        {
          key: stage.analyteKey,
          label: initialState.chemicalLabels[stage.analyteKey] ?? stage.analyteKey,
        },
        ...(markReagent ? [{ key: markReagent, label: stage.indicator.name }] : []),
        { key: "distilled_water", label: "Distilled water" },
      ]
    : [];

  const closeEverything = useCallback(() => {
    setDrawer(null);
    setPromptOpen(false);
    setHelpOpen(false);
    setAccessibilityOpen(false);
    setRecorder(null);
  }, [setPromptOpen, setHelpOpen, setAccessibilityOpen, setRecorder]);

  // Keyboard interaction (§40): E the primary verb, R rotate what is in hand,
  // F fly in to inspect, Space set down, Esc step back out. Typing a reading
  // never triggers any of them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isTextEntryTarget(document.activeElement)) return;
      const command = commandForCode(event.code);
      if (!command) return;

      if (command === "cancel") {
        // Browsers release the pointer lock themselves; this steps the UI back,
        // innermost surface first — the reading overlay is the most modal thing
        // on screen, the bench selection the least.
        if (readingMode) setReadingMode(false);
        else if (recorder !== null) setRecorder(null);
        else if (helpOpen) setHelpOpen(false);
        else if (accessibilityOpen) setAccessibilityOpen(false);
        else if (drawer !== null) setDrawer(null);
        else if (promptOpen) setPromptOpen(false);
        else {
          setSelectedApparatusKey(null);
          setSelectedReagentKey(null);
        }
        return;
      }

      if (command === "confirm") {
        if (event.code === "Space") event.preventDefault();
        if (carried) setCarried(null);
        return;
      }

      if (command === "rotate") {
        if (carried) rotateCarried(event.shiftKey ? -1 : 1);
        return;
      }

      // Tipping is what turns holding into pouring: T tips the vessel further
      // over, G brings it back upright. Both are the accessible equivalent of
      // turning the wrist while carrying, and neither sends anything to the
      // server on its own.
      if (command === "tilt") {
        if (carried) tiltCarried(1);
        return;
      }
      if (command === "level") {
        if (carried) tiltCarried(-1);
        return;
      }

      if (command === "focus") {
        const key = selectedApparatusKey ?? lookedAtKey;
        if (key === "burette") requestFocus("burette");
        else if (key === "conical_flask") requestFocus("flask");
        else if (key === "analytical_balance" || key === "beaker_250") requestFocus("balance");
        else if (key === "graduated_cylinder") requestFocus("cylinder");
        return;
      }

      // command === "interact"
      if (event.code === "KeyE") {
        if (carried) {
          setCarried(null);
          return;
        }
        if (verb.picksUp && carrying.available) {
          if (subjectHoldKind) {
            setCarried(subjectHoldKind);
            setPromptOpen(false);
            return;
          }
        }
        setPromptOpen(!promptOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    drawer,
    promptOpen,
    readingMode,
    recorder,
    helpOpen,
    accessibilityOpen,
    setRecorder,
    setHelpOpen,
    setAccessibilityOpen,
    carried,
    verb.picksUp,
    carrying.available,
    subjectKey,
    subjectHoldKind,
    lookedAtKey,
    selectedApparatusKey,
    setSelectedApparatusKey,
    setSelectedReagentKey,
    setCarried,
    rotateCarried,
    tiltCarried,
    requestFocus,
    setPromptOpen,
    setReadingMode,
  ]);

  return (
    <div
      className="fixed inset-0 h-[100dvh] w-full overflow-hidden bg-black"
      aria-label="Immersive 3D laboratory"
    >
      {/* The world: the whole viewport, no dashboard chrome, no 2D bench. */}
      <div className="absolute inset-0">
        <LabBench3D initialState={initialState} />
      </div>

      {/* Crosshair: what you look at is what you act on. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2",
          walkMode && pointerLocked ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="size-1.5 rounded-full bg-white/80 shadow-[0_0_0_1.5px_rgba(0,0,0,0.55)]" />
      </div>

      {/* The pointer is never captured silently: say so, and say how. */}
      {walkMode && !pointerLocked && (drawer === null || drawer === "results") ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center">
          <p className="rounded-md bg-surface/85 px-3 py-1.5 text-xs shadow backdrop-blur">
            Click the laboratory to look around · then WASD to walk, <span className="font-semibold">E</span> to
            interact, <span className="font-semibold">Esc</span> to release the pointer
          </p>
        </div>
      ) : null}

      <LabHud
        experimentNumber={initialState.experimentNumber}
        partLabel={partLabel}
        drawer={drawer}
        onProcedure={() => setDrawer(drawer === "procedure" ? null : "procedure")}
        onAccessible={() => setAccessibilityOpen(!accessibilityOpen)}
        onResults={() => setDrawer(drawer === "results" ? null : "results")}
        onHelp={() => setHelpOpen(!helpOpen)}
      />

      {/* The written procedure, one step at a time (§25). The student reads
          WHAT to do; the room decides HOW. */}
      <StepCard
        procedure={initialState.procedure}
        onOpenProcedure={() => setDrawer("procedure")}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {helpOpen ? <HelpOverlay onClose={() => setHelpOpen(false)} /> : null}

      <RecorderOverlay />

      {/* Reading Mode is the precision view (§15): the action card would sit
          right over the flask and the scale, so it stands down while the
          student is reading a meniscus and comes back when they close. */}
      {readingMode ? null : <ContextPrompt reagents={reagents} />}

      {readingMode ? <ReadingOverlay onClose={() => setReadingMode(false)} /> : null}

      {/* Drawers: the accessible surface. Hidden by default, never a sidebar. */}
      <div
        className={cn(
          "absolute bottom-0 left-0 top-0 z-30 w-72 max-w-[85vw] transition-transform",
          drawer === "procedure" ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={drawer === "procedure" ? undefined : true}
      >
        {drawer === "procedure" ? (
          // The panel owns its own complementary role and name; the drawer is
          // just the surface that slides it in.
          <div className="h-full overflow-y-auto bg-surface shadow-xl">
            <ProcedurePanel procedure={initialState.procedure} initialState={initialState} />
          </div>
        ) : null}
      </div>

      {/* The accessible laboratory (§35): the same steps as buttons, for a
          device without WebGL or a student who cannot perform pointer gestures.
          Hidden by default so the 3D room stays the primary interface. */}
      <div
        className={cn(
          "absolute bottom-0 right-0 top-0 z-30 w-80 max-w-[85vw] transition-transform",
          accessibilityOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={accessibilityOpen ? undefined : true}
      >
        {accessibilityOpen ? (
          <div className="h-full overflow-y-auto bg-surface px-3 py-3 shadow-xl">
            <ActionPanel initialState={initialState} />
          </div>
        ) : null}
      </div>

      {drawer === "results" ? (
        <div
          className="absolute inset-x-0 bottom-0 z-30 max-h-[45vh] overflow-y-auto border-t border-line bg-surface px-4 pb-4 pt-2 shadow-xl"
          role="dialog"
          aria-label="Results and data"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <MeasurementPanel />
            <ConcordancePanel />
            <div className="md:col-span-2">
              <TrialTable />
            </div>
            <div className="md:col-span-2">
              <ObservationPanel initialState={initialState} />
            </div>
            <div className="md:col-span-2">
              <CalculationPanel initialState={initialState} />
            </div>
            <div className="md:col-span-2">
              <ReviewSubmitPanel initialState={initialState} />
            </div>
          </div>
        </div>
      ) : null}

      {/* One "everything off" control, for anyone who wants the room back. */}
      {drawer !== null ||
      promptOpen ||
      readingMode ||
      helpOpen ||
      accessibilityOpen ||
      recorder !== null ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex justify-center">
          <Button size="sm" variant="secondary" className="pointer-events-auto" onClick={closeEverything}>
            Back to the laboratory
          </Button>
        </div>
      ) : null}

      {/* Exit lives in the HUD too, but keep a plain link for keyboard users. */}
      <Link className="sr-only" href="/student/experiments">
        Leave the laboratory
      </Link>
    </div>
  );
}
