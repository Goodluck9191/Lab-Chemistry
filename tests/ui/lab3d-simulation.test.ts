import {
  accumulateFlowTick,
  FLOW_MODES,
  quantizeDeliveryMl,
  shouldStopFlow,
  volumeTransferredMl,
} from "@/components/lab/3d/simulation/flow";
import { resetClock, tickClock } from "@/components/lab/3d/simulation/simulationClock";
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
  clampToBench,
  flaskReceivingValid,
  isInZone,
  PLACEMENT_ZONES,
  snapFlaskOnDrop,
  FLASK_UNDER_BURETTE_SLOT,
} from "@/components/lab/3d/simulation/spatial";
import {
  initialPhysicalLabState,
  resolveFlaskPosition,
} from "@/components/lab/3d/simulation/apparatus-state";
import {
  previewBuretteReadingMl,
  previewFlaskVolumeMl,
} from "@/components/lab/3d/simulation/fluidTransfer";
import { describe, expect, it } from "vitest";

/**
 * 3D simulation helpers: pure volume/flow/spatial math.
 *
 * These pin the VISUAL layer only — levels, rates, zones. Chemistry authority
 * stays in the domain engine; these tests assert the 3D layer can never
 * invent a chemistry result, only position meshes from public volumes.
 */

describe("volume mapping (visual only)", () => {
  it("maps a full burette to the top of the tube and an empty one to the bottom", () => {
    const geometry = { topY: 3.7, bottomY: 2.45, capacityMl: 50 };
    // NOTE: in scene units Y grows upwards, so topY > bottomY numerically;
    // the helper interpolates linearly between them.
    expect(buretteLiquidSurfaceY(0, geometry)).toBeCloseTo(3.7);
    expect(buretteLiquidSurfaceY(50, geometry)).toBeCloseTo(2.45);
    expect(buretteLiquidSurfaceY(25, geometry)).toBeCloseTo((3.7 + 2.45) / 2);
  });

  it("draws an unfilled burette as empty", () => {
    expect(buretteLiquidSurfaceY(null, { topY: 3.7, bottomY: 2.45, capacityMl: 50 })).toBeNull();
    expect(buretteFillFraction(null, 50)).toBe(0);
  });

  it("mirrors the 2D fill fraction (1 - reading / capacity)", () => {
    expect(buretteFillFraction(0, 50)).toBe(1);
    expect(buretteFillFraction(25, 50)).toBe(0.5);
    expect(buretteFillFraction(50, 50)).toBe(0);
  });

  it("raises the flask level monotonically with volume (cone cube-root)", () => {
    const geometry = { coneHeight: 0.85, coneCapacityMl: 250 };
    const low = flaskLiquidHeight(10, geometry);
    const mid = flaskLiquidHeight(80, geometry);
    const high = flaskLiquidHeight(240, geometry);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high).toBeLessThanOrEqual(0.85);
    expect(flaskLiquidHeight(0, geometry)).toBe(0);
  });

  it("widens the flask liquid surface with height to meet the glass wall", () => {
    const base = flaskLiquidRadiusAtHeight(0, 0.42, 0.14, 0.85);
    const top = flaskLiquidRadiusAtHeight(0.85, 0.42, 0.14, 0.85);
    expect(base).toBeCloseTo(0.42);
    expect(top).toBeCloseTo(0.14);
  });

  it("fills straight vessels linearly", () => {
    const geometry = { bottomY: 0, heightUnits: 1.5, capacityMl: 100 };
    expect(straightWallLiquidHeight(0, geometry)).toBe(0);
    expect(straightWallLiquidHeight(50, geometry)).toBeCloseTo(0.75);
    expect(straightWallLiquidHeight(200, geometry)).toBeCloseTo(1.5);
  });

  it("maps every observed flask colour without inventing chemistry", () => {
    for (const colour of ["colourless", "faint_pink", "pink", "deep_pink", null]) {
      expect(typeof flaskColourHex(colour)).toBe("string");
      expect(flaskColourOpacity(colour)).toBeGreaterThan(0);
    }
  });
});

describe("deterministic flow", () => {
  it("accumulates volume as rate × time with no randomness", () => {
    expect(volumeTransferredMl(2.0, 1.5)).toBeCloseTo(3.0);
    expect(volumeTransferredMl(0.15, 10)).toBeCloseTo(1.5);
    expect(volumeTransferredMl(1, 0)).toBe(0);
  });

  it("quantizes deliveries to dropwise units of the graduation", () => {
    expect(quantizeDeliveryMl(1.03, 0.1)).toBeCloseTo(1.05);
    expect(quantizeDeliveryMl(0.01, 0.1)).toBeCloseTo(0);
  });

  it("orders flow modes fast > medium > dropwise", () => {
    expect(FLOW_MODES.FAST.mlPerSecond).toBeGreaterThan(FLOW_MODES.MEDIUM.mlPerSecond);
    expect(FLOW_MODES.MEDIUM.mlPerSecond).toBeGreaterThan(FLOW_MODES.DROPWISE.mlPerSecond);
  });

  it("flags an empty burette and the protocol ceiling", () => {
    const empty = accumulateFlowTick({
      alreadyAccumulatedMl: 49.9,
      deltaSeconds: 1,
      mode: "FAST",
      graduationMl: 0.1,
      buretteRemainingMl: 50,
    });
    expect(empty.buretteEmpty).toBe(true);
    const capped = accumulateFlowTick({
      alreadyAccumulatedMl: 59.9,
      deltaSeconds: 10,
      mode: "FAST",
      graduationMl: 0.1,
      buretteRemainingMl: 200,
    });
    expect(capped.protocolCapped).toBe(true);
    expect(capped.rawMl).toBeLessThanOrEqual(60);
  });

  it("stops flow when the stopcock closes, the burette empties, the vessel moves or the trial ends", () => {
    const running = { stopcockOpen: true, buretteRemainingMl: 10, receiverInPosition: true, trialOpen: true };
    expect(shouldStopFlow(running)).toBe(false);
    expect(shouldStopFlow({ ...running, stopcockOpen: false })).toBe(true);
    expect(shouldStopFlow({ ...running, buretteRemainingMl: 0 })).toBe(true);
    expect(shouldStopFlow({ ...running, receiverInPosition: false })).toBe(true);
    expect(shouldStopFlow({ ...running, trialOpen: false })).toBe(true);
  });

  it("clamps wild frame deltas so a backgrounded tab cannot dump the burette", () => {
    const clock = tickClock(resetClock(), 10_000, 2.0);
    expect(clock.elapsedSeconds).toBeLessThanOrEqual(0.25);
    expect(clock.accumulatedMl).toBeLessThanOrEqual(0.5);
  });
});

describe("placement zones (forgiving, deterministic)", () => {
  it("accepts the flask anywhere inside the receiving zone", () => {
    expect(flaskReceivingValid({ x: -2.0, z: -0.5 })).toBe(true);
    expect(flaskReceivingValid({ x: -2.6, z: -1.1 })).toBe(true);
    expect(flaskReceivingValid({ x: 2.0, z: 0.5 })).toBe(false);
  });

  it("snaps a dropped flask to the exact under-burette slot", () => {
    expect(snapFlaskOnDrop({ x: -2.1, z: -0.4 })).toEqual(FLASK_UNDER_BURETTE_SLOT);
    expect(snapFlaskOnDrop({ x: 1.0, z: 1.0 })).toEqual({ x: 1.0, z: 1.0 });
  });

  it("keeps dragged objects on the bench", () => {
    expect(clampToBench({ x: 99, z: -99 })).toEqual({ x: 4.6, z: -2.2 });
  });

  it("exposes balance, waste and transfer zones", () => {
    expect(isInZone({ x: 2.2, z: -0.6 }, PLACEMENT_ZONES.balance)).toBe(true);
    expect(isInZone({ x: 4.0, z: 0.6 }, PLACEMENT_ZONES.waste)).toBe(true);
    expect(isInZone({ x: 0.9, z: -0.9 }, PLACEMENT_ZONES.transfer)).toBe(true);
  });
});

describe("physical state separation", () => {
  it("starts with no selection, no focus and medium flow", () => {
    const state = initialPhysicalLabState();
    expect(state.selection).toBeNull();
    expect(state.focus).toBeNull();
    expect(state.flowMode).toBe("MEDIUM");
  });

  it("holds no chemistry: only poses, modes and UI flags", () => {
    const state = initialPhysicalLabState();
    const json = JSON.stringify(state).toLowerCase();
    for (const forbidden of ["molarity", "endpoint", "concentration", "titrant", "hidden", "seed"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("parks the flask on the tile until the server confirms placement", () => {
    expect(resolveFlaskPosition({ serverPlaced: false, draggedPos: null }).slot).toBe("tile");
    expect(resolveFlaskPosition({ serverPlaced: true, draggedPos: null }).slot).toBe("under_burette");
    expect(
      resolveFlaskPosition({ serverPlaced: false, draggedPos: { x: -2.0, z: -0.5 } }).slot,
    ).toBe("under_burette");
  });
});

describe("pour preview (discarded on confirm)", () => {
  it("adds the unconfirmed pour to the server reading, capped at capacity", () => {
    expect(
      previewBuretteReadingMl({ serverReadingMl: 5, accumulatedMl: 1.2, capacityMl: 50 }),
    ).toBeCloseTo(6.2);
    expect(
      previewBuretteReadingMl({ serverReadingMl: 49.5, accumulatedMl: 5, capacityMl: 50 }),
    ).toBe(50);
    expect(previewBuretteReadingMl({ serverReadingMl: null, accumulatedMl: 2, capacityMl: 50 })).toBeNull();
  });

  it("previews the flask rise from the quantized delivery", () => {
    expect(previewFlaskVolumeMl({ serverVolumeMl: 40, accumulatedMl: 1.03, graduationMl: 0.1 })).toBeCloseTo(41.05);
    expect(previewFlaskVolumeMl({ serverVolumeMl: 40, accumulatedMl: 0, graduationMl: 0.1 })).toBe(40);
  });
});
