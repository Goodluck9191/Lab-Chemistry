import { describe, expect, it } from "vitest";

import {
  CAMERA_MOVE_BOUNDS,
  clampMoveTarget,
  computeMoveOffset,
  isTypingTarget,
  moveKeyForCode,
  NO_MOVE,
  WALK_SPEED_UNITS_PER_SEC,
} from "@/components/lab/3d/simulation/movement";
import { isFullscreen, toggleFullscreen } from "@/components/lab/3d/fullscreen";
import { snapBeakerOnDrop } from "@/components/lab/3d/simulation/spatial";
import { BALANCE_SLOT } from "@/components/lab/3d/simulation/spatial";
import { guideTargetForNextAction } from "@/components/lab/3d/simulation/apparatus-state";

/**
 * Immersive laboratory support logic: keyboard walking, fullscreen
 * presentation and beaker placement. Pure and dependency-free — the renderer
 * only positions meshes from these results.
 */
describe("immersive camera movement", () => {
  it("maps WASD and arrows to directions", () => {
    expect(moveKeyForCode("KeyW")).toBe("forward");
    expect(moveKeyForCode("ArrowUp")).toBe("forward");
    expect(moveKeyForCode("KeyS")).toBe("back");
    expect(moveKeyForCode("KeyA")).toBe("left");
    expect(moveKeyForCode("KeyD")).toBe("right");
    expect(moveKeyForCode("KeyE")).toBeNull();
    expect(moveKeyForCode("Space")).toBeNull();
  });

  it("walks into the screen at yaw 0", () => {
    const step = computeMoveOffset({
      keys: { ...NO_MOVE, forward: true },
      yawRadians: 0,
      speedUnitsPerSec: WALK_SPEED_UNITS_PER_SEC,
      deltaSeconds: 1,
    });
    expect(step.dx).toBeCloseTo(0, 10);
    expect(step.dz).toBeCloseTo(-WALK_SPEED_UNITS_PER_SEC * 0.05, 10);
  });

  it("strafes right relative to the view direction", () => {
    const step = computeMoveOffset({
      keys: { ...NO_MOVE, right: true },
      yawRadians: 0,
      speedUnitsPerSec: 2,
      deltaSeconds: 0.05,
    });
    expect(step.dx).toBeCloseTo(0.1, 10);
    expect(step.dz).toBeCloseTo(0, 10);
  });

  it("normalises diagonal movement and clamps frame jumps", () => {
    const straight = computeMoveOffset({
      keys: { ...NO_MOVE, forward: true },
      yawRadians: 0,
      speedUnitsPerSec: 2,
      deltaSeconds: 0.05,
    });
    const diagonal = computeMoveOffset({
      keys: { ...NO_MOVE, forward: true, right: true },
      yawRadians: 0,
      speedUnitsPerSec: 2,
      deltaSeconds: 0.05,
    });
    expect(Math.hypot(diagonal.dx, diagonal.dz)).toBeCloseTo(
      Math.hypot(straight.dx, straight.dz),
      10,
    );
    const jump = computeMoveOffset({
      keys: { ...NO_MOVE, forward: true },
      yawRadians: 0,
      speedUnitsPerSec: 100,
      deltaSeconds: 10,
    });
    expect(Math.hypot(jump.dx, jump.dz)).toBeLessThanOrEqual(5 + 1e-9);
    expect(computeMoveOffset({ keys: NO_MOVE, yawRadians: 0, speedUnitsPerSec: 2, deltaSeconds: 1 })).toEqual({
      dx: 0,
      dz: 0,
    });
  });

  it("keeps the camera target inside the walkable area", () => {
    expect(clampMoveTarget({ x: 99, z: -99 })).toEqual({
      x: CAMERA_MOVE_BOUNDS.maxX,
      z: CAMERA_MOVE_BOUNDS.minZ,
    });
    expect(clampMoveTarget({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
  });

  it("pauses walking while the student types a reading", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("beaker placement", () => {
  it("snaps onto the balance pan and rests freely elsewhere", () => {
    expect(snapBeakerOnDrop({ x: BALANCE_SLOT.x, z: BALANCE_SLOT.z })).toEqual(BALANCE_SLOT);
    const free = { x: -3, z: 2 };
    expect(snapBeakerOnDrop(free)).toEqual(free);
  });
});

describe("task guidance", () => {
  it("points the marker at the apparatus of the current step", () => {
    expect(guideTargetForNextAction("rinse_burette")).toBe("burette");
    expect(guideTargetForNextAction("condition_burette")).toBe("burette");
    expect(guideTargetForNextAction("read_burette")).toBe("burette");
    expect(guideTargetForNextAction("weigh_beaker")).toBe("beaker_250");
    expect(guideTargetForNextAction("dissolve_khp")).toBe("beaker_250");
    expect(guideTargetForNextAction("measure_stock")).toBe("graduated_cylinder");
    expect(guideTargetForNextAction("pipette_analyte")).toBe("graduated_cylinder");
    expect(guideTargetForNextAction("mix_solution")).toBe("volumetric_flask");
    expect(guideTargetForNextAction("add_indicator")).toBe("reagent_bottle");
    expect(guideTargetForNextAction("place_flask")).toBe("conical_flask");
    expect(guideTargetForNextAction("discard_to_waste")).toBe("waste_container");
  });

  it("shows no marker while reviewing or when the kind is unknown", () => {
    expect(guideTargetForNextAction(null)).toBeNull();
    expect(guideTargetForNextAction(undefined)).toBeNull();
    expect(guideTargetForNextAction("review_submit")).toBeNull();
    expect(guideTargetForNextAction("read_only")).toBeNull();
    expect(guideTargetForNextAction("something_new")).toBeNull();
  });
});

describe("fullscreen presentation", () => {
  it("enters and exits through the API", async () => {
    let held: unknown = null;
    const doc = {
      get fullscreenElement() {
        return held;
      },
      exitFullscreen: async () => {
        held = null;
      },
    };
    const el = {
      requestFullscreen: async () => {
        held = el;
      },
    };
    expect(await toggleFullscreen(el, doc)).toBe("entered");
    expect(isFullscreen(doc)).toBe(true);
    expect(await toggleFullscreen(el, doc)).toBe("exited");
    expect(isFullscreen(doc)).toBe(false);
  });

  it("degrades when the API is missing or throws", async () => {
    expect(await toggleFullscreen(null, null)).toBe("unsupported");
    expect(await toggleFullscreen({}, {})).toBe("unsupported");
    expect(
      await toggleFullscreen(
        {
          requestFullscreen: async () => {
            throw new Error("denied");
          },
        },
        {},
      ),
    ).toBe("unsupported");
    expect(isFullscreen(null)).toBe(false);
  });
});
