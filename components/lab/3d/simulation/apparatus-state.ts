/**
 * Physical simulation state for the 3D laboratory.
 *
 * THREE SEPARATE CONCEPTS — never merged (§4 of the phase brief):
 *
 *   1. CHEMISTRY STATE — lives in the domain engine + public state (NaOH
 *      concentration, moles, endpoint, concordance). This file never holds it.
 *   2. PHYSICAL STATE (this file) — burette/flask positions, stopcock visual
 *      angle target, flow-mode selection, placement validity, camera focus.
 *      UI-only: it drives meshes and may be discarded on reload.
 *   3. VISUAL STATE — animation progress inside components (stream phase,
 *      swirl angle). Local to the render loop.
 *
 * The physical layer may REQUEST chemistry changes (via the existing action
 * protocol through `perform()`), but it never WRITES them: the server's public
 * state flowing back down is what moves liquid levels and colours.
 */

import type { FlowMode } from "./flow";
import {
  BEAKER_SLOT,
  BALANCE_SLOT,
  CYLINDER_SLOT,
  FLASK_TILE_SLOT,
  FLASK_UNDER_BURETTE_SLOT,
  WASTE_SLOT,
  flaskReceivingValid,
  type BenchPoint,
} from "./spatial";

/** Camera focus targets (§7/§45). Null means free orbit. */
export type ApparatusFocusKey = "burette" | "flask" | "balance" | "cylinder" | null;

/** Which 3D apparatus the student has selected (highlight + context). */
export type PhysicalSelectionKey =
  | "burette"
  | "conical_flask"
  | "analytical_balance"
  | "graduated_cylinder"
  | "beaker_250"
  | "reagent_bottle"
  | "glass_rod"
  | "waste_container"
  | "volumetric_flask"
  | null;

/** Where the student's flask physically stands right now. */
export type FlaskSlot = "tile" | "under_burette" | "free";

export interface PhysicalLabState {
  /** Student-dragged flask position; null until first dragged. */
  flaskBenchPos: BenchPoint | null;
  /** Whether the flask currently counts as positioned for titration. */
  flaskInReceivingZone: boolean;
  /** Selected flow mode for the 3D stopcock pour. */
  flowMode: FlowMode;
  /** Camera focus target. */
  focus: ApparatusFocusKey;
  /** 3D selection (mirrors the bench selection keys where they overlap). */
  selection: PhysicalSelectionKey;
  /** Glass-rod stirring animation active (visual only). */
  stirring: boolean;
}

export function initialPhysicalLabState(): PhysicalLabState {
  return {
    flaskBenchPos: null,
    flaskInReceivingZone: false,
    flowMode: "MEDIUM",
    focus: null,
    selection: null,
    stirring: false,
  };
}

/** Resolve the flask's effective bench position from server + physical state. */
export function resolveFlaskPosition(args: {
  serverPlaced: boolean;
  draggedPos: BenchPoint | null;
}): { pos: BenchPoint; slot: FlaskSlot } {
  if (args.draggedPos) {
    return {
      pos: args.draggedPos,
      slot: flaskReceivingValid(args.draggedPos) ? "under_burette" : "free",
    };
  }
  if (args.serverPlaced) return { pos: { ...FLASK_UNDER_BURETTE_SLOT }, slot: "under_burette" };
  return { pos: { ...FLASK_TILE_SLOT }, slot: "tile" };
}

/** Fixed slots for the apparatus that never drags. */
export const FIXED_SLOTS = {
  beaker: { ...BEAKER_SLOT },
  balance: { ...BALANCE_SLOT },
  cylinder: { ...CYLINDER_SLOT },
  waste: { ...WASTE_SLOT },
} satisfies Record<string, BenchPoint>;
