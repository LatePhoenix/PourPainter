import { isValidSeed } from '../domain/seed';

/**
 * Seeded PRNG (Mulberry32). Same seed → same sequence for recipe replay.
 * Returns floats in [0, 1).
 */
export type Rng = {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** Current internal state (unsigned 32-bit). */
  state(): number;
};

export function createRng(seed: number): Rng {
  if (!isValidSeed(seed)) {
    throw new RangeError('RNG seed must be an integer in [0, 2^32)');
  }

  let t = seed >>> 0;

  const next = (): number => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r ^ (r + Math.imul(r ^ (r >>> 7), 61 | r))) >>> 0;
    return (r ^ (r >>> 14)) >>> 0;
  };

  return {
    next(): number {
      return next() / 4294967296;
    },
    nextInt(maxExclusive: number): number {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError('nextInt maxExclusive must be a positive finite number');
      }
      return Math.floor(this.next() * maxExclusive);
    },
    state(): number {
      return t >>> 0;
    },
  };
}
