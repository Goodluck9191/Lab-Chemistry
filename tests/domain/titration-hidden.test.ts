import { describe, expect, it } from "vitest";
import { createSeededRandom, deriveSeed } from "@/domain/simulation/random";
import { deriveHiddenState } from "@/domain/simulation/titration/hidden";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";

describe("seeded randomness and hidden parameters", () => {
  it("reproduces the identical stream for the same seed", () => {
    const a = createSeededRandom("attempt-seed-1");
    const b = createSeededRandom("attempt-seed-1");
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("varies the stream for different seeds", () => {
    const a = createSeededRandom("attempt-seed-1").next();
    const b = createSeededRandom("attempt-seed-2").next();
    expect(a).not.toBe(b);
  });

  it("derives the same hidden reality for the same seed", () => {
    const first = deriveHiddenState(exp02TitrationConfig, "seed-abc", 0.08);
    const second = deriveHiddenState(exp02TitrationConfig, "seed-abc", 0.08);
    expect(first).toEqual(second);
  });

  it("varies hidden concentrations across seeds within the configured ranges", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 10; i += 1) {
      const hidden = deriveHiddenState(exp02TitrationConfig, `seed-${i}`, 0.08);
      const molarity = hidden.stages["stage-a-khp-naoh"].trueTitrantMolarityM;
      expect(molarity).toBeGreaterThanOrEqual(0.18);
      expect(molarity).toBeLessThanOrEqual(0.22);
      seen.add(molarity);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("scopes sub-seeds independently", () => {
    expect(deriveSeed("root", "a")).not.toBe(deriveSeed("root", "b"));
    expect(() => deriveSeed("", "a")).toThrow(RangeError);
  });
});
