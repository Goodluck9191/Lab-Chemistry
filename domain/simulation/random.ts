/**
 * Deterministic seeded random number generator for the simulation core.
 *
 * CONTRACT
 * - One seed per attempt (stored in `attempt_secrets.seed`, never sent to the
 *   browser). Same seed -> byte-identical hidden parameters, noise and
 *   endpoints, so tests and replays reproduce a simulation exactly.
 * - The domain engine NEVER calls Math.random(); all variation flows through
 *   a `SeededRandom` created from the attempt seed.
 * - xmur3 string hash + mulberry32 stream: small, dependency-free, and
 *   deterministic across V8/Node runtimes for our purposes (32-bit integer
 *   arithmetic only).
 */
export interface SeededRandom {
  /** Uniform value in [0, 1). */
  readonly next: () => number;
  /** Uniform value in [min, max). */
  readonly range: (min: number, max: number) => number;
  /** Integer in [min, max] inclusive. */
  readonly int: (min: number, max: number) => number;
  /** Approximately normal noise with mean 0 and the given std dev. */
  readonly noise: (stdDev: number) => number;
  /** Pick one element of a non-empty array. */
  readonly pick: <T>(items: readonly T[]) => T;
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a reproducible stream from an attempt seed string. */
export function createSeededRandom(seed: string): SeededRandom {
  if (typeof seed !== "string" || seed.length === 0) {
    throw new RangeError("seed must be a non-empty string");
  }
  const hash = xmur3(seed)();
  const uniform = mulberry32(hash);

  const next = (): number => uniform();

  return {
    next,
    range: (min: number, max: number) => {
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        throw new RangeError(`invalid range [${min}, ${max})`);
      }
      return min + (max - min) * uniform();
    },
    int: (min: number, max: number) => {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`invalid int range [${min}, ${max}]`);
      }
      return min + Math.floor(uniform() * (max - min + 1));
    },
    noise: (stdDev: number) => {
      if (!Number.isFinite(stdDev) || stdDev < 0) {
        throw new RangeError(`stdDev must be >= 0, got ${stdDev}`);
      }
      if (stdDev === 0) return 0;
      // Average of 3 uniforms approximates a centred bell shape; plenty for
      // burette/balance noise and fully deterministic given the seed.
      const u = (uniform() + uniform() + uniform()) / 3;
      return (u - 0.5) * 2 * stdDev * 1.7320508075688772;
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new RangeError("cannot pick from an empty array");
      }
      return items[Math.floor(uniform() * items.length)];
    },
  };
}

/**
 * Derive a scoped sub-seed so independent concerns (e.g. "stageA" vs "stageB"
 * vs "noise") draw from independent streams while remaining reproducible.
 */
export function deriveSeed(rootSeed: string, scope: string): string {
  if (rootSeed.length === 0 || scope.length === 0) {
    throw new RangeError("rootSeed and scope must be non-empty");
  }
  return `${rootSeed}::${scope}`;
}
