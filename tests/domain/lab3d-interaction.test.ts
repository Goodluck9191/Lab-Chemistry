import { describe, expect, it } from "vitest";
import {
  LAB_KEYBINDS,
  commandForCode,
  isTextEntryTarget,
  keybindFor,
  normaliseAngle,
  rotationLabel,
  ROTATE_STEP_RADIANS,
} from "@/components/lab/3d/simulation/keymap";
import {
  STOPCOCK_MAX_ANGLE_DEG,
  clampStopcockAngle,
  nextStopcockAngle,
  previousStopcockAngle,
  stopcockAngleForOpenFlag,
  stopcockAngleFromDrag,
  stopcockFlowModeFor,
  stopcockIsOpen,
  stopcockNotchFor,
  stopcockPositionFor,
  stopcockRateMlPerSecond,
} from "@/components/lab/3d/simulation/stopcock";
import {
  canCarry,
  carryKindFor,
  dropPointInFront,
  homeSlotFor,
  panSlot,
  primaryVerbFor,
  releasePointFor,
  releasesIntoWaste,
  releasesOntoBalance,
  releasesUnderBurette,
  rotateHeldLeft,
  rotateHeldRight,
} from "@/components/lab/3d/interactions/carry";
import { lookCandidates, lookPointFor, lookTargetFor } from "@/components/lab/3d/interactions/lookTarget";
import { BALANCE_SLOT, FLASK_TILE_SLOT, WASTE_SLOT, type BenchPoint } from "@/components/lab/3d/simulation/spatial";

/**
 * The pure heart of the immersive interaction layer: keys, the valve, carrying
 * things and looking at things. None of this needs a browser, which is exactly
 * why it is tested here — the rendered scene cannot be unit-tested in jsdom.
 */

describe("laboratory keybinds", () => {
  it("maps the documented keys, and only those", () => {
    expect(commandForCode("KeyE")).toBe("interact");
    expect(commandForCode("KeyR")).toBe("rotate");
    expect(commandForCode("KeyF")).toBe("focus");
    expect(commandForCode("Space")).toBe("confirm");
    expect(commandForCode("Escape")).toBe("cancel");
    expect(commandForCode("KeyQ")).toBeNull();
    expect(commandForCode("Digit1")).toBeNull();
  });

  it("advertises exactly one key per command", () => {
    const commands = LAB_KEYBINDS.map((bind) => bind.command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(keybindFor("interact").key).toBe("E");
  });

  it("recognises text entry so typing a reading never walks the camera", () => {
    expect(isTextEntryTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "textarea" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV" })).toBe(false);
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntryTarget(null)).toBe(false);
  });

  it("turns an object by whole steps and keeps the angle bounded", () => {
    const once = rotateHeldRight({ yawRadians: 0 });
    expect(once.yawRadians).toBeCloseTo(ROTATE_STEP_RADIANS, 6);
    expect(rotateHeldLeft(once).yawRadians).toBeCloseTo(0, 6);
    // A long walk of presses cannot drift past a half turn.
    let rotation = { yawRadians: 0 };
    for (let i = 0; i < 40; i += 1) rotation = rotateHeldRight(rotation);
    expect(Math.abs(rotation.yawRadians)).toBeLessThanOrEqual(Math.PI + 1e-9);
    // A half turn is a half turn, whichever sign the wrap lands on.
    expect(Math.abs(normaliseAngle(3 * Math.PI))).toBeCloseTo(Math.PI, 6);
  });

  it("names the rotation in degrees for the HUD", () => {
    expect(rotationLabel({ yawRadians: 0 })).toBe("0°");
    expect(rotationLabel({ yawRadians: Math.PI / 2 })).toBe("90°");
    expect(rotationLabel({ yawRadians: -Math.PI / 2 })).toBe("-90°");
  });
});

describe("the stopcock is a valve, not a switch", () => {
  it("stays shut through the first few degrees", () => {
    expect(stopcockPositionFor(0)).toBe("closed");
    expect(stopcockIsOpen(0)).toBe(false);
    expect(stopcockFlowModeFor(0)).toBeNull();
    expect(stopcockRateMlPerSecond(0)).toBe(0);
    expect(stopcockNotchFor(0).label).toBe("Closed");
  });

  it("passes progressively more as the handle turns", () => {
    const crack = stopcockRateMlPerSecond(8);
    const dropwise = stopcockRateMlPerSecond(24);
    const medium = stopcockRateMlPerSecond(48);
    const fast = stopcockRateMlPerSecond(80);
    expect(crack).toBeGreaterThan(0);
    expect(dropwise).toBeGreaterThanOrEqual(crack);
    expect(medium).toBeGreaterThan(dropwise);
    expect(fast).toBeGreaterThan(medium);
    expect(stopcockFlowModeFor(80)).toBe("FAST");
  });

  it("reuses the flow modes the panels already use, so a 3D pour and a button pour are identical", () => {
    // 0.15 mL/s is FLOW_MODES.DROPWISE; the valve must not invent its own rates.
    expect(stopcockRateMlPerSecond(20)).toBeCloseTo(0.15, 6);
    expect(stopcockRateMlPerSecond(50)).toBeCloseTo(0.8, 6);
    expect(stopcockRateMlPerSecond(90)).toBeCloseTo(2.0, 6);
  });

  it("clamps the handle to its quarter turn", () => {
    expect(clampStopcockAngle(-10)).toBe(0);
    expect(clampStopcockAngle(200)).toBe(STOPCOCK_MAX_ANGLE_DEG);
    expect(clampStopcockAngle(Number.NaN)).toBe(0);
    expect(stopcockAngleForOpenFlag(true)).toBe(STOPCOCK_MAX_ANGLE_DEG);
    expect(stopcockAngleForOpenFlag(false)).toBe(0);
  });

  it("steps through its openings and wraps back to shut", () => {
    expect(nextStopcockAngle(0)).toBeGreaterThan(0);
    expect(stopcockIsOpen(nextStopcockAngle(0))).toBe(true);
    let angle = nextStopcockAngle(0);
    for (let i = 0; i < 4; i += 1) angle = nextStopcockAngle(angle);
    expect(angle).toBe(0);
    // And the slow-down direction is the mirror image.
    expect(previousStopcockAngle(0)).toBe(0);
    expect(stopcockIsOpen(previousStopcockAngle(90))).toBe(true);
  });

  it("maps an upward drag to opening, and a downward drag to closing", () => {
    // Up is negative deltaY in screen pixels.
    expect(stopcockAngleFromDrag({ startAngleDeg: 45, deltaYPixels: -80 })).toBeGreaterThan(45);
    expect(stopcockAngleFromDrag({ startAngleDeg: 45, deltaYPixels: 80 })).toBeLessThan(45);
    expect(stopcockAngleFromDrag({ startAngleDeg: 0, deltaYPixels: 10_000 })).toBe(0);
    expect(stopcockAngleFromDrag({ startAngleDeg: 0, deltaYPixels: -10_000 })).toBe(
      STOPCOCK_MAX_ANGLE_DEG,
    );
  });
});

describe("carrying a vessel", () => {
  it("refuses to move anything on a frozen attempt or mid-save", () => {
    expect(canCarry({ canWrite: false, pending: false }).available).toBe(false);
    expect(canCarry({ canWrite: false, pending: false }).reason).toMatch(/read-only/i);
    expect(canCarry({ canWrite: true, pending: true }).available).toBe(false);
    expect(canCarry({ canWrite: true, pending: true }).reason).toMatch(/saving/i);
    expect(canCarry({ canWrite: true, pending: false })).toEqual({ available: true, reason: null });
  });

  it("names the vessel it would pick up", () => {
    expect(carryKindFor("beaker_250")).toBe("beaker");
    expect(carryKindFor("conical_flask")).toBe("flask");
    expect(carryKindFor("burette")).toBeNull();
    expect(carryKindFor(null)).toBeNull();
  });

  it("offers the obvious verb for what is under the crosshair", () => {
    expect(primaryVerbFor("beaker_250", null).label).toBe("Pick up");
    expect(primaryVerbFor("beaker_250", null).picksUp).toBe(true);
    expect(primaryVerbFor("burette", null)).toEqual({ label: "Interact", picksUp: false });
    expect(primaryVerbFor("burette", "flask").label).toBe("Set down");
  });

  it("snaps a released vessel onto the pan or under the burette", () => {
    expect(releasePointFor("flask", { x: -2.0, z: -0.5 })).toEqual({ x: -2.0, z: -0.5 });
    expect(releasePointFor("beaker", { ...BALANCE_SLOT })).toEqual({ ...BALANCE_SLOT });
    expect(homeSlotFor("flask")).toEqual({ ...FLASK_TILE_SLOT });
    expect(panSlot()).toEqual({ ...BALANCE_SLOT });
  });

  it("recognises the zones a release means something in", () => {
    expect(releasesIntoWaste("flask", { ...WASTE_SLOT })).toBe(true);
    expect(releasesIntoWaste("flask", { ...FLASK_TILE_SLOT })).toBe(false);
    expect(releasesOntoBalance("beaker", { ...BALANCE_SLOT })).toBe(true);
    // A flask is not weighed.
    expect(releasesOntoBalance("flask", { ...BALANCE_SLOT })).toBe(false);
    expect(releasesUnderBurette("flask", { x: -2.0, z: -0.5 })).toBe(true);
    expect(releasesUnderBurette("beaker", { x: -2.0, z: -0.5 })).toBe(false);
  });

  it("lands a set-down object where the student is looking", () => {
    // Standing back from the bench, looking level: the fallback arm reaches
    // forward — and stops at the bench edge rather than hovering off it.
    const level = dropPointInFront({
      origin: { x: 0, y: 1.62, z: 4.4 },
      direction: { x: 0, y: 0, z: -1 },
    });
    expect(level.z).toBeCloseTo(2.6, 6);
    expect(level.x).toBeCloseTo(0, 6);

    // Looking down at the bench intersects the surface in front of the eye,
    // then clamps to the bench — a vessel is never set down off the edge.
    const down = dropPointInFront({
      origin: { x: 0, y: 1.62, z: 4.4 },
      direction: { x: 0, y: -1, z: 0 },
    });
    expect(down.z).toBeCloseTo(2.6, 6);

    // Looking up never invents a far-away point: it stays on the bench.
    const up = dropPointInFront({
      origin: { x: 0, y: 1.62, z: 4.4 },
      direction: { x: 0, y: 1, z: 0 },
    });
    expect(up.z).toBeLessThanOrEqual(2.6);
  });
});

describe("what the crosshair is on", () => {
  const flaskPos: BenchPoint = { x: -2.0, z: -0.5 };

  it("offers a candidate for every bench instrument", () => {
    const keys = lookCandidates(flaskPos).map((candidate) => candidate.key);
    expect(keys).toContain("burette");
    expect(keys).toContain("analytical_balance");
    expect(keys).toContain("waste_container");
  });

  it("follows the flask when the flask moves", () => {
    const moved = lookPointFor("conical_flask", { x: 1.5, z: 1.0 });
    expect(moved.x).toBeCloseTo(1.5, 6);
    expect(moved.z).toBeCloseTo(1.0, 6);
  });

  it("picks the object being aimed at, not merely the nearest one", () => {
    // Standing in front of the burette, looking straight at it.
    const target = lookTargetFor({
      origin: { x: -2.0, y: 1.62, z: 1.6 },
      direction: { x: 0, y: 1, z: -2 },
      candidates: lookCandidates(flaskPos),
    });
    expect(target).toBe("burette");
  });

  it("returns nothing when looking at empty bench", () => {
    expect(
      lookTargetFor({
        origin: { x: 0, y: 1.62, z: 4.4 },
        direction: { x: 0, y: 0, z: 1 },
        candidates: lookCandidates(flaskPos),
      }),
    ).toBeNull();
  });

  it("ignores anything too far away to reach", () => {
    expect(
      lookTargetFor({
        origin: { x: -2.0, y: 1.62, z: 1.6 },
        direction: { x: 0, y: 1, z: -2 },
        candidates: lookCandidates(flaskPos),
        maxDistanceUnits: 0.5,
      }),
    ).toBeNull();
  });

  it("survives a degenerate direction instead of throwing", () => {
    expect(
      lookTargetFor({
        origin: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 0 },
        candidates: lookCandidates(flaskPos),
      }),
    ).toBeNull();
  });
});
