import { describe, expect, it } from "vitest";
import {
  MAX_TILT_RADIANS,
  NEUTRAL_HOLD,
  POUR_TILT_RADIANS,
  TILT_STEP_RADIANS,
  clampTilt,
  heldObjectPoint,
  horizontalForward,
  isPourTilt,
  pourOriginPoint,
  setTilt,
  tiltBy,
  tiltLabel,
} from "@/components/lab/3d/interactions/hold";
import {
  POUR_RECEIVER_TOLERANCE_UNITS,
  pourAngleFor,
  pourFlowModeFor,
  pourIntent,
  pourRateMlPerSecond,
  pourZoneAt,
  pourZoneLabel,
} from "@/components/lab/3d/interactions/pour";
import {
  buretteMountOutcome,
  clampInReach,
  mountLabel,
  readingNeedsMount,
  titrationNeedsMount,
} from "@/components/lab/3d/interactions/mounting";
import {
  HOLD_SPECS,
  holdKindFor,
  holdReleaseFor,
  holdSpecFor,
  holdVerbFor,
} from "@/components/lab/3d/interactions/carry";
import {
  BALANCE_SLOT,
  BURETTE_CRADLE_SLOT,
  CLAMP_SLOT,
  FLASK_TILE_SLOT,
  WASTE_SLOT,
} from "@/components/lab/3d/simulation/spatial";

/**
 * The physical gestures behind Phase 5.6.1: tipping a vessel to pour it,
 * hanging a burette on its clamp, and putting things down where they belong.
 * All pure — the rendered scene cannot be exercised in jsdom, so the rules are
 * pinned here instead.
 */

describe("holding an object in the hand", () => {
  it("rides in front of the eye, level with the line of sight", () => {
    const point = heldObjectPoint({
      origin: { x: 0, y: 1.6, z: 4.4 },
      forward: { x: 0, y: 0, z: -1 },
    });
    // In front (smaller z) and below the eye.
    expect(point.z).toBeLessThan(4.4);
    expect(point.y).toBeLessThan(1.6);
    // A flat direction still yields a real forward, never a NaN.
    const flat = horizontalForward({ x: 0, y: 1, z: 0 });
    expect(flat).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("swings the mouth forward as the vessel tips", () => {
    const level = pourOriginPoint({
      origin: { x: 0, y: 1.6, z: 4.4 },
      forward: { x: 0, y: 0, z: -1 },
      pose: NEUTRAL_HOLD,
    });
    const tipped = pourOriginPoint({
      origin: { x: 0, y: 1.6, z: 4.4 },
      forward: { x: 0, y: 0, z: -1 },
      pose: { yawRadians: 0, tiltRadians: MAX_TILT_RADIANS },
    });
    // Upright the mouth is high; tipped it drops and reaches forward.
    expect(tipped.y).toBeLessThan(level.y);
    expect(tipped.z).toBeLessThan(level.z);
  });

  it("clamps the tilt and only pours past the threshold", () => {
    expect(clampTilt(Number.NaN)).toBe(0);
    expect(clampTilt(100)).toBeCloseTo(MAX_TILT_RADIANS, 6);
    expect(clampTilt(-100)).toBeCloseTo(-MAX_TILT_RADIANS, 6);

    expect(isPourTilt(NEUTRAL_HOLD)).toBe(false);
    expect(isPourTilt(setTilt(NEUTRAL_HOLD, POUR_TILT_RADIANS - 0.01))).toBe(false);
    expect(isPourTilt(setTilt(NEUTRAL_HOLD, POUR_TILT_RADIANS))).toBe(true);

    // Tilting by key steps and cannot run past the maximum.
    let pose = setTilt(NEUTRAL_HOLD, 0);
    for (let i = 0; i < 200; i += 1) pose = tiltBy(pose, 1);
    expect(pose.tiltRadians).toBeCloseTo(MAX_TILT_RADIANS, 6);
    expect(tiltBy(NEUTRAL_HOLD, -1, 1).tiltRadians).toBeCloseTo(-TILT_STEP_RADIANS, 6);

    expect(tiltLabel(NEUTRAL_HOLD)).toBe("Upright");
    expect(tiltLabel(setTilt(NEUTRAL_HOLD, POUR_TILT_RADIANS))).toBe("Pouring");
    expect(tiltLabel(setTilt(NEUTRAL_HOLD, POUR_TILT_RADIANS / 2))).toBe("Tilting");
  });
});

describe("pouring a held vessel", () => {
  const targets = {
    flask: { x: -2.0, z: -0.5 },
    beaker: { x: 0.2, z: 0.9 },
    cylinder: { x: 0.9, z: -0.9 },
    volumetricFlask: { x: -3.7, z: 1.3 },
  };

  it("passes nothing while the vessel is upright", () => {
    expect(pourRateMlPerSecond(0)).toBe(0);
    expect(pourFlowModeFor(0)).toBeNull();
    const intent = pourIntent({
      pose: NEUTRAL_HOLD,
      aimPoint: { x: -2.0, z: -0.5 },
      targets,
    });
    expect(intent.pouring).toBe(false);
    expect(intent.rateMlPerSecond).toBe(0);
    expect(intent.label).toBe("Upright");
  });

  it("passes progressively more the further it is tipped", () => {
    const justPouring = pourRateMlPerSecond(POUR_TILT_RADIANS + 0.02);
    const halfway = pourRateMlPerSecond((POUR_TILT_RADIANS + MAX_TILT_RADIANS) / 2);
    const full = pourRateMlPerSecond(MAX_TILT_RADIANS);
    expect(justPouring).toBeGreaterThan(0);
    expect(halfway).toBeGreaterThanOrEqual(justPouring);
    expect(full).toBeGreaterThan(halfway);
    expect(pourFlowModeFor(MAX_TILT_RADIANS)).toBe("FAST");
  });

  it("reads the zone from where the pour is aimed", () => {
    expect(pourZoneAt({ ...WASTE_SLOT }, targets)).toBe("waste");
    expect(pourZoneAt({ ...BALANCE_SLOT }, targets)).toBe("balance");
    expect(pourZoneAt({ x: -2.0, z: -0.5 }, targets)).toBe("flask");
    expect(pourZoneAt({ x: -3.7, z: 1.3 }, targets)).toBe("volumetric_flask");
    // Far from anything: the bench top.
    expect(pourZoneAt({ x: -4.6, z: 2.6 }, targets)).toBe("bench");
    expect(pourZoneLabel("waste")).toMatch(/waste/i);
  });

  it("only counts a vessel as a receiver within tolerance", () => {
    const near = pourZoneAt({ x: 0.2 + POUR_RECEIVER_TOLERANCE_UNITS * 0.5, z: 0.9 }, targets);
    expect(near).toBe("beaker");
    const far = pourZoneAt(
      { x: 0.2 + POUR_RECEIVER_TOLERANCE_UNITS * 2, z: 0.9 },
      { ...targets, flask: { x: 99, z: 99 } },
    );
    expect(far).toBe("bench");
  });

  it("describes the pour for the prompt", () => {
    const intent = pourIntent({
      pose: setTilt(NEUTRAL_HOLD, POUR_TILT_RADIANS + 0.05),
      aimPoint: { ...WASTE_SLOT },
      targets,
    });
    expect(intent.pouring).toBe(true);
    expect(intent.zone).toBe("waste");
    expect(intent.label).toMatch(/waste/i);
    expect(intent.flowMode).not.toBeNull();
  });

  it("shares one rate curve with the stopcock", () => {
    // An upright vessel passes nothing; a full tip is a fully open tap; a
    // halfway tip sits between the crack and wide open.
    expect(pourAngleFor(0)).toBe(0);
    expect(pourAngleFor(MAX_TILT_RADIANS)).toBeCloseTo(90, 6);
    const mid = pourAngleFor((POUR_TILT_RADIANS + MAX_TILT_RADIANS) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(90);
    // Just past the pour threshold it is already cracked open, not silent.
    expect(pourNoteJustPastThreshold()).toBeGreaterThan(0);
  });

  /** Rate the instant a vessel is tipped past its pour threshold. */
  function pourNoteJustPastThreshold(): number {
    return pourRateMlPerSecond(POUR_TILT_RADIANS + 0.001);
  }
});

describe("mounting the burette", () => {
  it("mounts a release near the clamp and cradles it otherwise", () => {
    const on = buretteMountOutcome({ ...CLAMP_SLOT });
    expect(on.mounted).toBe(true);
    expect(on.pos).toEqual({ ...CLAMP_SLOT });

    const off = buretteMountOutcome({ x: 4.6, z: 2.6 });
    expect(off.mounted).toBe(false);
    expect(off.pos).toEqual({ ...BURETTE_CRADLE_SLOT });
  });

  it("highlights the clamp when the burette is within reach", () => {
    expect(clampInReach({ ...CLAMP_SLOT })).toBe(true);
    expect(clampInReach({ x: 4.6, z: 2.6 })).toBe(false);
  });

  it("refuses a reading until the burette is up", () => {
    expect(readingNeedsMount({ mounted: false }).available).toBe(false);
    expect(readingNeedsMount({ mounted: false }).reason).toMatch(/mount/i);
    expect(readingNeedsMount({ mounted: true })).toEqual({ available: true, reason: null });
  });

  it("refuses titration until the burette is up AND the flask is under it", () => {
    expect(titrationNeedsMount({ mounted: false, flaskInReceiving: true }).available).toBe(false);
    expect(titrationNeedsMount({ mounted: true, flaskInReceiving: false }).available).toBe(false);
    expect(titrationNeedsMount({ mounted: true, flaskInReceiving: true }).available).toBe(true);
    expect(mountLabel(true)).toMatch(/mounted/i);
    expect(mountLabel(false)).toMatch(/cradle/i);
  });
});

describe("the general holdable model", () => {
  it("names every holdable and where it lives", () => {
    expect(holdSpecFor("burette").mounts).toBe(true);
    expect(holdSpecFor("beaker").mounts).toBe(false);
    expect(holdSpecFor("burette").pourable).toBe(false);
    expect(holdSpecFor("beaker").pourable).toBe(true);
    for (const spec of Object.values(HOLD_SPECS)) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(Number.isFinite(spec.home.x)).toBe(true);
      expect(Number.isFinite(spec.home.z)).toBe(true);
    }
  });

  it("maps a selection to what can be carried", () => {
    expect(holdKindFor("beaker_250")).toBe("beaker");
    expect(holdKindFor("conical_flask")).toBe("flask");
    // Fixed apparatus, and apparatus whose mesh cannot yet ride in the hand,
    // stay on the bench: the logical state must match the picture.
    expect(holdKindFor("analytical_balance")).toBeNull();
    expect(holdKindFor("waste_container")).toBeNull();
    expect(holdKindFor("burette")).toBeNull();
    expect(holdKindFor("graduated_cylinder")).toBeNull();
    expect(holdKindFor(null)).toBeNull();
  });

  it("offers the obvious verb, and Set down while holding", () => {
    expect(holdVerbFor("burette", null)).toEqual({ label: "Interact", picksUp: false });
    expect(holdVerbFor("beaker_250", null).picksUp).toBe(true);
    expect(holdVerbFor("analytical_balance", null)).toEqual({
      label: "Interact",
      picksUp: false,
    });
    expect(holdVerbFor("beaker_250", "flask")).toEqual({ label: "Set down", picksUp: false });
  });

  it("resolves a release by what is underneath", () => {
    expect(holdReleaseFor("burette", { x: -2.0, z: -0.5 })).toEqual({
      kind: "burette_mount",
      mounted: true,
      pos: { ...CLAMP_SLOT },
    });
    expect(holdReleaseFor("flask", { ...WASTE_SLOT }).kind).toBe("discard");
    expect(holdReleaseFor("beaker", { ...BALANCE_SLOT })).toEqual({
      kind: "balance",
      pos: { ...BALANCE_SLOT },
    });
    expect(holdReleaseFor("flask", { x: -2.0, z: -0.5 }).kind).toBe("under_burette");
    expect(holdReleaseFor("glass_rod", { ...FLASK_TILE_SLOT }).kind).toBe("rest");
  });
});
