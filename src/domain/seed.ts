const MAX_SEED_EXCLUSIVE = 2 ** 32;

/** True when `seed` is an integer in [0, 2³²). */
export function isValidSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed < MAX_SEED_EXCLUSIVE;
}
