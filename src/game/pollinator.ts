import type { ReplayEntry } from "./save";

/**
 * The rules for pollinators: who can arrive, what they carry, and whether one that was ignored
 * pollinated anyway.
 *
 * Pure and canvas-free, like `hit.ts` and `describe.ts`. The interesting assertions here are
 * about RULES, and a browser test per rule is slow and proves less — in particular a driver that
 * waited for a 0.15-probability event to happen would be a flaky test by construction. Kept
 * here, the probability is measured over twenty thousand draws in a millisecond.
 *
 * The numbers are opening values chosen by feel, not findings. They are exported so the tests
 * reference them rather than restating them: a test that hard-codes 0.15 stops testing the
 * constant the moment the constant moves.
 *
 * Durations are TICKS, not seconds. `SPEED` is 1.4 per frame at 60fps, so a second is about 84
 * ticks and a value that looks like a number of seconds is off by two orders of magnitude.
 */

/** How many pollen-free insects may be drifting through at once. */
export const AMBIENT_MAX = 2;

/** Mean gap between carrier arrivals — about 90 seconds of bloom-bearing play. */
export const CARRIER_INTERVAL_TICKS = 7560;

/** How long a carrier sits on its flower before giving up and leaving — about 12 seconds. */
export const CARRIER_SIT_TICKS = 1008;

/** Chance that a carrier which was ignored turns out to have pollinated on its way out. */
export const POLLINATED_CHANCE = 0.15;

/**
 * A carrier needs somewhere to land and something to carry.
 *
 * The empty-log case is the reason this mechanic needs no unlock flag or tutorial: a new garden
 * has no history, so nothing can arrive until the player has replaced a plant and given the
 * forest something to offer back.
 */
export function canCarrierArrive(
  log: ReplayEntry[],
  openBlooms: number,
): boolean {
  return log.length > 0 && openBlooms > 0;
}

/**
 * A serialized genome from the retirement log, or null when there is nothing to draw from.
 *
 * The caller must pass `retirementLog` and NOT `garden.retired`. Retired plants are composited
 * into the background on load, so `garden.retired` comes back empty after a reload while the
 * replay list survives — drawing from the wrong one produces a feature that works until the
 * player refreshes the page.
 */
export function pickPollen(
  log: ReplayEntry[],
  rand: () => number,
): string | null {
  if (log.length === 0) return null;
  return log[Math.floor(rand() * log.length)]!.g;
}

/** Did an ignored carrier pollinate before it left? */
export function didPollinate(rand: () => number): boolean {
  return rand() < POLLINATED_CHANCE;
}
