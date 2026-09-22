import { describe, expect, it } from "vitest";

import {
  accumulateFlowTick,
  FLOW_MODES,
  MAX_DELIVERY_PER_ACTION_ML,
  quantizeDeliveryMl,
  shouldStopFlow,
  volumeTransferredMl,
} from "@/components/lab/3d/simulation/flow";
import {
  buretteFillFraction,
  buretteLiquidSurfaceY,
  flaskColourHex,
  flaskColourOpacity,
  flaskLiquidHeight,
  flaskLiquidRadiusAtHeight,
  straightWallLiquidHeight,
} from "@/components/lab/3d/simulation/volume-mapping";
import {
  balancePlacementValid,
  BENCH_BOUNDS,
  clampToBench,
  distance2D,
  FLASK_TILE_SLOT,
  FLASK_UNDER_BURETTE_SLOT,
  flaskReceivingValid,
  isInZone,
  PLACEMENT_ZONES,
  snapFlaskOnDrop,
  wastePlacementValid,
} from "@/components/lab/3d/simulation/spatial";
import {
  previewBuretteReadingMl,
  previewFlaskVolumeMl,
} from "@/components/lab/3d/simulation/fluidTransfer";
import {
  initialPhysicalLabState,
  resolveFlaskPosition,
} from "@/components/lab/3d/simulation/apparatus-state";
import { resetClock, tickClock } from "@/components/lab/3d/simulation/simulationClock";

/**
 * Phase 5.5 — pure 3D simulation logic.
 *
 * These modules are the ONLY part of the 3D layer that is unit-tested: they
 * are dependency-free functions mapping authoritative volumes to scene
 * geometry and interaction state. Rendering (Three.js meshes) is verified by
 * typecheck + build + manual inspection, never pixel-by-pixel.
 */
describe("3D flow accumulation", () => {
  it("transfers rate × time with no randomness", () => {
    expect(volumeTransferredMl(0.8, 0.1)).toBeCloseTo(0.08, 10);
    expect(volumeTransferredMl(FLOW_MODES.FAST.mlPerSecond, 1)).toBe(2.0);
    expect(volumeTransferredMl(0, 1)).toBe(0);
    expect(volumeTransferredMl(0.8, -1)).toBe(0);
  });

  it("orders flow modes fast > medium > dropwise", () => {
    expect(FLOW_MODES.FAST.mlPerSecond).toBeGreaterThan(FLOW_MODES.MEDIUM.mlPerSecond);
    expect(FLOW_MODES.MEDIUM.mlPerSecond).toBeGreaterThan(FLOW_MODES.DROPWISE.mlPerSecond);
  });

  it("quantizes deliveries to half-graduation units", () => {
    expect(quantizeDeliveryMl(1.0, 0.1)).toBeCloseTo(1.0, 10);
    expect(quantizeDeliveryMl(0.03, 0.1)).toBeCloseTo(0.05, 10);
    expect(quantizeDeliveryMl(0, 0.1)).toBe(0);
    expect(quantizeDeliveryMl(1.0, 0)).toBe(0);
  });

  it("accumulates deterministically and caps at the protocol ceiling", () => {
    const tick = accumulateFlowTick({
      alreadyAccumulatedMl: 1.0,
      deltaSeconds: 0.1,
      mode: "MEDIUM",
      graduationMl: 0.1,
      buretteRemainingMl: 50,
    });
    expect(tick.rawMl).toBeCloseTo(1.08, 10);
    expect(tick.buretteEmpty).toBe(false);
    expect(tick.protocolCapped).toBe(false);

    const capped = accumulateFlowTick({
      alreadyAccumulatedMl: MAX_DELIVERY_PER_ACTION_ML - 0.01,
      deltaSeconds: 10,
      mode: "FAST",
      graduationMl: 0.1,
      buretteRemainingMl: 50,
    });
    expect(capped.rawMl).toBe(MAX_DELIVERY_PER_ACTION_ML);
    expect(capped.protocolCapped).toBe(true);
  });

  it("flags an exhausted burette", () => {
    const tick = accumulateFlowTick({
      alreadyAccumulatedMl: 49.9,
      deltaSeconds: 1,
      mode: "FAST",
      graduationMl: 0.1,
      buretteRemainingMl: 50,
    });
    expect(tick.buretteEmpty).toBe(true);
  });

  it("stops flow on closed stopcock, empty burette, moved vessel or closed trial", () => {
    const open = { stopcockOpen: true, buretteRemainingMl: 10, receiverInPosition: true, trialOpen: true };
    expect(shouldStopFlow(open)).toBe(false);
    expect(shouldStopFlow({ ...open, stopcockOpen: false })).toBe(true);
    expect(shouldStopFlow({ ...open, buretteRemainingMl: 0 })).toBe(true);
    expect(shouldStopFlow({ ...open, receiverInPosition: false })).toBe(true);
    expect(shouldStopFlow({ ...open, trialOpen: false })).toBe(true);
  });
});

describe("3D volume mapping", () => {
  const tube = { topY: 3.7, bottomY: 2.45, capacityMl: 50 };

  it("maps burette readings continuously from top (0 mL) to bottom (capacity)", () => {
    expect(buretteLiquidSurfaceY(0, tube)).toBeCloseTo(3.7, 10);
    expect(buretteLiquidSurfaceY(50, tube)).toBeCloseTo(2.45, 10);
    const quarter = buretteLiquidSurfaceY(12.5, tube);
    const half = buretteLiquidSurfaceY(25, tube);
    expect(quarter).toBeGreaterThan(half ?? 0);
    expect(buretteLiquidSurfaceY(null, tube)).toBeNull();
    expect(buretteLiquidSurfaceY(99, tube)).toBeCloseTo(2.45, 10);
  });

  it("derives the fill fraction from the reading", () => {
    expect(buretteFillFraction(0, 50)).toBe(1);
    expect(buretteFillFraction(50, 50)).toBe(0);
    expect(buretteFillFraction(null, 50)).toBe(0);
    expect(buretteFillFraction(25, 50)).toBeCloseTo(0.5, 10);
  });

  it("raises the flask level monotonically with volume", () => {
    const geometry = { coneHeight: 0.85, coneCapacityMl: 250 };
    expect(flaskLiquidHeight(0, geometry)).toBe(0);
    expect(flaskLiquidHeight(-5, geometry)).toBe(0);
    const low = flaskLiquidHeight(30, geometry);
    const high = flaskLiquidHeight(60, geometry);
    expect(high).toBeGreaterThan(low);
    expect(flaskLiquidHeight(500, geometry)).toBeCloseTo(0.85, 10);
  });

  it("widens the flask surface radius with height", () => {
    const base = flaskLiquidRadiusAtHeight(0, 0.42, 0.14, 0.85);
    const top = flaskLiquidRadiusAtHeight(0.85, 0.42, 0.14, 0.85);
    expect(base).toBeCloseTo(0.42, 10);
    expect(top).toBeCloseTo(0.14, 10);
  });

  it("fills straight-walled vessels linearly", () => {
    const geometry = { bottomY: 0, heightUnits: 2, capacityMl: 100 };
    expect(straightWallLiquidHeight(50, geometry)).toBeCloseTo(1, 10);
    expect(straightWallLiquidHeight(0, geometry)).toBe(0);
    expect(straightWallLiquidHeight(200, geometry)).toBe(2);
  });

  it("maps flask colours to display values", () => {
    expect(flaskColourHex("faint_pink")).not.toBe(flaskColourHex("colourless"));
    expect(flaskColourHex(null)).toBe(flaskColourHex("colourless"));
    expect(flaskColourOpacity("deep_pink")).toBeGreaterThan(flaskColourOpacity("faint_pink"));
  });
});

describe("3D placement validation", () => {
  it("accepts the flask inside the forgiving receiving zone", () => {
    expect(flaskReceivingValid(FLASK_UNDER_BURETTE_SLOT)).toBe(true);
    expect(flaskReceivingValid({ x: -2.0, z: -0.5 })).toBe(true);
    expect(flaskReceivingValid(FLASK_TILE_SLOT)).toBe(false);
    expect(flaskReceivingValid({ x: 4, z: 2 })).toBe(false);
  });

  it("snaps drops inside the zone under the tip and keeps the rest", () => {
    expect(snapFlaskOnDrop({ x: -2.1, z: -0.4 })).toEqual(FLASK_UNDER_BURETTE_SLOT);
    const free = { x: 1.5, z: 1.5 };
    expect(snapFlaskOnDrop(free)).toEqual(free);
  });

  it("clamps dragged objects onto the bench", () => {
    const clamped = clampToBench({ x: 99, z: -99 });
    expect(clamped.x).toBe(BENCH_BOUNDS.maxX);
    expect(clamped.z).toBe(BENCH_BOUNDS.minZ);
    expect(clampToBench({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
  });

  it("validates balance and waste zones", () => {
    expect(balancePlacementValid({ x: 2.2, z: -0.6 })).toBe(true);
    expect(balancePlacementValid({ x: 0, z: 0 })).toBe(false);
    expect(wastePlacementValid({ x: 4.0, z: 0.6 })).toBe(true);
    expect(wastePlacementValid({ x: 0, z: 0 })).toBe(false);
    expect(isInZone({ x: 0.5, z: -0.8 }, PLACEMENT_ZONES.transfer)).toBe(true);
  });

  it("measures planar distance", () => {
    expect(distance2D({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
  });
});

describe("3D transfer preview", () => {
  it("previews the falling meniscus without touching server state", () => {
    expect(previewBuretteReadingMl({ serverReadingMl: null, accumulatedMl: 2, capacityMl: 50 })).toBeNull();
    expect(previewBuretteReadingMl({ serverReadingMl: 5, accumulatedMl: 0, capacityMl: 50 })).toBe(5);
    expect(previewBuretteReadingMl({ serverReadingMl: 5, accumulatedMl: 2, capacityMl: 50 })).toBe(7);
    expect(previewBuretteReadingMl({ serverReadingMl: 49, accumulatedMl: 5, capacityMl: 50 })).toBe(50);
  });

  it("previews the rising flask level with quantized delivery", () => {
    expect(previewFlaskVolumeMl({ serverVolumeMl: 30, accumulatedMl: 0, graduationMl: 0.1 })).toBe(30);
    expect(previewFlaskVolumeMl({ serverVolumeMl: 30, accumulatedMl: 1.0, graduationMl: 0.1 })).toBeCloseTo(
      31,
      10,
    );
  });
});

describe("3D apparatus state", () => {
  it("starts with a neutral physical state", () => {
    const initial = initialPhysicalLabState();
    expect(initial.flaskBenchPos).toBeNull();
    expect(initial.flowMode).toBe("MEDIUM");
    expect(initial.focus).toBeNull();
    expect(initial.selection).toBeNull();
  });

  it("resolves the flask position from drag, server or tile", () => {
    expect(resolveFlaskPosition({ serverPlaced: false, draggedPos: null }).slot).toBe("tile");
    expect(resolveFlaskPosition({ serverPlaced: true, draggedPos: null }).slot).toBe("under_burette");
    expect(
      resolveFlaskPosition({ serverPlaced: false, draggedPos: { ...FLASK_UNDER_BURETTE_SLOT } }).slot,
    ).toBe("under_burette");
    expect(resolveFlaskPosition({ serverPlaced: true, draggedPos: { x: 3, z: 2 } }).slot).toBe("free");
  });
});

describe("3D simulation clock", () => {
  it("accumulates rate × clamped delta", () => {
    const next = tickClock(resetClock(), 100, 0.8);
    expect(next.elapsedSeconds).toBeCloseTo(0.1, 10);
    expect(next.accumulatedMl).toBeCloseTo(0.08, 10);
  });

  it("clamps background-tab jumps", () => {
    const next = tickClock(resetClock(), 10_000, 2.0);
    expect(next.elapsedSeconds).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(next.accumulatedMl).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("ignores invalid input", () => {
    const state = resetClock();
    expect(tickClock(state, -5, 1)).toBe(state);
    expect(tickClock(state, Number.NaN, 1)).toBe(state);
  });
});
