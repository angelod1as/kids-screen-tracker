/**
 * What an adult may type on the Configuration screen, as opposed to what a
 * column can hold (#26, D35, D36). Pure and client-safe: the server refuses and
 * the screen explains from the same predicate (D33).
 */

/** Narrowest halving band (D35). Not a float floor: exactness is D39's job. */
export const MIN_DECAY_STEP_HOURS = 0.25;

/**
 * The rate D35 argues the floor against; named so `limits.test.ts` measures the
 * argument.
 */
export const SEED_RATE = 1.5;

/**
 * One day: D6's window includes the day itself, so zero is a permanent bonus
 * (D36).
 */
export const MIN_RETURN_BONUS_AFTER_DAYS = 1;

/**
 * `taxa × passo × 2`. Null with no step (no asymptote, D2) or no rate (D11).
 * Uses `base_rate`, so it is a calibration aid and never an input (D11).
 */
export function asymptoteHours(
  baseRate: number | null,
  decayStepHours: number | null,
): number | null {
  if (baseRate === null || decayStepHours === null) return null;

  return baseRate * decayStepHours * 2;
}

/**
 * Null is D2's off switch. Only the floor: finiteness and rounding belong to
 * `src/db/input.ts`, and a second guard here would hide from the sabotage
 * matrix.
 */
export function isUsableDecayStep(decayStepHours: number | null): boolean {
  if (decayStepHours === null) return true;

  return decayStepHours >= MIN_DECAY_STEP_HOURS;
}

/**
 * Both halves are load-bearing: zero bonus with zero days is the seed's "no
 * bonus".
 */
export function isUsableReturnBonus(
  returnBonusPct: number,
  returnBonusAfterDays: number,
): boolean {
  if (returnBonusPct <= 0) return true;

  return returnBonusAfterDays >= MIN_RETURN_BONUS_AFTER_DAYS;
}
