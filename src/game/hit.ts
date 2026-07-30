import type { Bloom, Vec2 } from "../types";
import { cullOccludedBlooms } from "../render/stage";
import { isGrown, TRAY_CAP, type Garden, type Planting } from "./garden";

/**
 * Pointer targets. All hit-testing is pure and canvas-free so it can be tested without a
 * DOM — the alternative is a Playwright test per verb, which is slow and proves less.
 */
export type BloomHit = { plotIndex: number; bloom: Bloom };

/**
 * Blooms a plant is currently SHOWING.
 *
 * Two filters, and both matter. `cullOccludedBlooms` is what the renderer draws, so hit
 * testing anything else would let the player click a flower that is not on screen. The tick
 * filter stops a click landing on a flower that has not opened yet.
 */
export function shownBlooms(p: Planting, now: number): Bloom[] {
  const age = now - p.plantedAt;
  return cullOccludedBlooms(p.plant.blooms.filter((b) => b.tick <= age));
}

/**
 * The bloom under a point, or null.
 *
 * Picks the CLOSEST centre among all hits rather than the first. With overlapping canopies
 * the first match is whichever plot happens to come first in the array, which makes clicking
 * a crowded bed feel arbitrary.
 */
export function bloomAt(
  g: Garden,
  p: Vec2,
  now: number,
  slack = 1.15,
): BloomHit | null {
  let best: BloomHit | null = null;
  let bestD = Infinity;
  g.plots.forEach((plot, plotIndex) => {
    if (!plot.occupant) return;
    for (const bloom of shownBlooms(plot.occupant, now)) {
      const d = Math.hypot(bloom.center.x - p.x, bloom.center.y - p.y);
      if (d <= bloom.radius * slack && d < bestD) {
        bestD = d;
        best = { plotIndex, bloom };
      }
    }
  });
  return best;
}

/**
 * The plot nearest a drop point, or null if the drop was nowhere near the bed.
 *
 * Reach defaults to the widest gap between adjacent plots rather than to a constant. A fixed
 * radius cannot tell "dropped between two plots" from "dropped nowhere near the garden": at
 * 95px with plots 200px apart there is a 10px dead band in the middle of every gap where a
 * drop silently does nothing and the player has no way to see why. Deriving reach from the
 * layout removes the dead band by construction — every point between two plots is inside
 * one's reach — while still rejecting a drop off in the sky.
 *
 * Horizontal distance only: a plot is a position on the ground, and demanding vertical
 * precision near the soil line would make planting fiddly for no gain.
 */
export function plotAt(g: Garden, p: Vec2, reach?: number): number | null {
  const xs = g.plots.map((pl) => pl.x).sort((a, b) => a - b);
  const spacing =
    xs.length > 1
      ? Math.max(...xs.slice(1).map((x, i) => x - xs[i]!))
      : Infinity;

  let best: number | null = null;
  let bestD = reach ?? spacing;
  g.plots.forEach((plot, i) => {
    const d = Math.abs(plot.x - p.x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export type TrayLayout = {
  x: number;
  y: number;
  slot: number;
  radius: number;
};

/** Where tray slot `i` sits. Pure, so the renderer and the hit test cannot disagree. */
export function traySlot(i: number, w: number, h: number): TrayLayout {
  const radius = 9;
  const gap = 30;
  const width = (TRAY_CAP - 1) * gap;
  return {
    x: w / 2 - width / 2 + i * gap,
    y: h - 26,
    slot: i,
    radius,
  };
}

/** The tray seed under a point, or null. */
export function seedAt(
  g: Garden,
  p: Vec2,
  w: number,
  h: number,
): number | null {
  for (let i = 0; i < g.tray.length; i++) {
    const s = traySlot(i, w, h);
    if (Math.hypot(s.x - p.x, s.y - p.y) <= s.radius * 1.8)
      return g.tray[i]!.id;
  }
  return null;
}

/**
 * Whether a plant is far enough along to be worth clicking.
 *
 * A bloom appears the tick its shoot terminates, but a plant still growing will sprout more
 * flowers; cloning off a half-grown plant is legal and not a mistake, so this only drives a
 * hover affordance, never a refusal.
 */
export function isReady(p: Planting, now: number): boolean {
  return isGrown(p, now);
}
