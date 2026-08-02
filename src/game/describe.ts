import { isGrown, type Planting } from "./garden";
import { shortLabel } from "./notebook";
import { serialize } from "../genome/serialize";

/**
 * Accessible labels for the hidden mirror.
 *
 * Pure and canvas-free, for the same reason `hit.ts` is: the interesting assertions here are
 * about WORDS, and a Playwright test per phrasing is slow and proves less than a unit test.
 *
 * The `isGrown` gate is the whole point of this module. `shortLabel` and `describeTraits` will
 * happily decode any genome handed to them — they are used by the card, which only ever renders
 * a grown plant (`garden/garden.ts:865`). Nothing stops a caller pointing them at a seedling,
 * and the mirror is the one place that would plausibly try.
 */
export function plotLabel(
  index: number,
  occ: Planting | null,
  now: number,
): string {
  const n = index + 1;
  if (!occ) return `plot ${n}, empty`;
  if (!isGrown(occ, now)) return `plot ${n}, growing`;
  return `plot ${n}, ${shortLabel(serialize(occ.genome))}, finished`;
}

/**
 * Position only, deliberately.
 *
 * Seeds are drawn as generic seeds and the HUD shows only an opaque share code, so naming a
 * seed's traits or its parentage would tell a screen-reader player something no sighted player
 * can know. The tray is genuinely hard to keep track of as a result — for everyone equally. If
 * that proves unplayable the fix is to disclose seed origin in the GAME, and let this follow.
 */
export function seedLabel(index: number, total: number): string {
  return `seed ${index + 1} of ${total}`;
}

/**
 * What a pollen carrier reads as in the mirror.
 *
 * Names its source, unlike `seedLabel`, and the difference is not an inconsistency. A tray seed
 * is anonymous because the game never shows what a seed is — they are drawn identically and the
 * HUD carries only an opaque share code. A retired plant is the opposite: the drawer already
 * renders every one of them from its real genome, so withholding the name here would hide
 * something the game hands over one tab away.
 */
export function carrierLabel(pollenCode: string): string {
  return `a pollinator carrying pollen from a ${shortLabel(pollenCode)}`;
}

/**
 * What the live region says when a plant finishes growing.
 *
 * Returns the empty string rather than a description when the plant has not finished, so a
 * caller that forgets to check cannot announce a seedling's traits. The gate is repeated here
 * instead of trusted from the call site: this is the one string in the game that is spoken
 * without the player asking for it.
 */
export function grownLine(index: number, occ: Planting, now: number): string {
  if (!isGrown(occ, now)) return "";
  return `plot ${index + 1} finished: ${shortLabel(serialize(occ.genome))}`;
}
