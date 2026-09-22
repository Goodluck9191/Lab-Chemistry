"use client";

import { Button } from "@/components/ui/button";
import { useLabUi } from "../../lab-state-provider";
import { Lab3DActions } from "../Lab3DActions";
import { lookTargetLabel } from "../interactions/lookTarget";
import { carryingLabel, primaryVerbFor } from "../interactions/carry";
import { LAB_KEYBINDS, keybindFor } from "../simulation/keymap";
import type { PhysicalSelectionKey } from "../simulation/apparatus-state";

/**
 * The contextual interaction UI (§6).
 *
 * Two tiers, neither of them permanent:
 *
 *   1. LOOK HINT — a one-line card naming whatever the crosshair is on, with
 *      the keys that act on it. It appears when you look at something and
 *      disappears when you look away; you never have to dismiss it.
 *
 *   2. ACTION CARD — what E opens: the steps that are actually available for
 *      the thing you are looking at or holding, gated by the same rules the
 *      server enforces. Closing it (Esc) returns the whole screen to the world.
 *
 * The apparatus picker inside the card is deliberate: it is how a student who
 * cannot aim a crosshair (keyboard-only, or reading the page linearly) still
 * reaches every action. That is an accessibility path, not a menu.
 */

const SELECTABLE_LABELS: Record<string, string> = {
  burette: "Burette, 50 mL",
  conical_flask: "Erlenmeyer flask",
  analytical_balance: "Analytical balance",
  beaker: "Beaker, 250 mL",
  graduated_cylinder: "Measuring cylinder",
  volumetric_flask: "Volumetric flask",
  waste_container: "Waste container",
  reagent_bottle: "Reagent shelf",
};

function selectionKeyFor(args: {
  selectedReagentKey: string | null;
  selectedApparatusKey: string | null;
  lookedAtKey: PhysicalSelectionKey;
}): PhysicalSelectionKey {
  if (args.selectedReagentKey !== null) return "reagent_bottle";
  if (args.selectedApparatusKey !== null) {
    return (args.selectedApparatusKey as Exclude<PhysicalSelectionKey, null>) ?? null;
  }
  return args.lookedAtKey;
}

function labelFor(key: PhysicalSelectionKey): string {
  if (key === null) return "Nothing in reach";
  return SELECTABLE_LABELS[key] ?? lookTargetLabel(key);
}

export function ContextPrompt({ reagents }: { reagents: Array<{ key: string; label: string }> }) {
  const {
    selectedReagentKey,
    selectedApparatusKey,
    lookedAtKey,
    carried,
    promptOpen,
    setPromptOpen,
  } = useLabUi();

  const subject = selectionKeyFor({ selectedReagentKey, selectedApparatusKey, lookedAtKey });
  const title = carried ? carryingLabel(carried) : labelFor(subject);
  const verb = primaryVerbFor(subject, carried);

  if (!promptOpen) {
    if (subject === null && !carried) return null;
    return (
      <div
        className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-3"
        role="status"
        aria-label="Contextual interaction prompt"
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-surface/90 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur">
          <span className="font-medium">{title}</span>
          {carried ? (
            <span className="text-muted">
              <span className="font-medium text-foreground">{keybindFor("rotate").key}</span>{" "}
              {keybindFor("rotate").label.toLowerCase()} ·{" "}
              <span className="font-medium text-foreground">{keybindFor("confirm").key}</span> set down
            </span>
          ) : (
            <span className="text-muted">
              <span className="font-medium text-foreground">{keybindFor("interact").key}</span>{" "}
              {verb.label.toLowerCase()} ·{" "}
              <span className="font-medium text-foreground">{keybindFor("focus").key}</span>{" "}
              {keybindFor("focus").label.toLowerCase()}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-3"
      role="dialog"
      aria-label="Contextual interaction prompt"
    >
      <div className="pointer-events-auto max-h-[52vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface/95 p-2.5 shadow-xl backdrop-blur">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold">{title}</p>
          <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            {LAB_KEYBINDS.filter((bind) =>
              carried
                ? bind.command === "rotate" || bind.command === "confirm" || bind.command === "cancel"
                : bind.command !== "rotate",
            ).map((bind) => (
              <span key={bind.command} className="rounded border border-line px-1 py-0.5">
                <span className="font-semibold text-foreground">{bind.key}</span> {bind.label}
              </span>
            ))}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto h-6 px-2 text-[11px]"
            onClick={() => setPromptOpen(false)}
          >
            Close
          </Button>
        </div>
        <Lab3DActions reagents={reagents} />
      </div>
    </div>
  );
}
