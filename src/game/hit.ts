import type { Bloom, Plant, Vec2 } from "../types";
import { cullOccludedBlooms } from "../render/stage";
import { isGrown, TRAY_CAP, type Garden, type Planting } from "./garden";

/**
 * Pointer targets. All hit-testing is pure and canvas-free so it can be tested without a
 * DOM — the alternative is a Playwright test per verb, which is slow and proves less.
 */
export type BloomHit = { plotIndex: number; bloom: Bloom };

/**
 * Memoised culls, keyed on the plant.
 *
 * `cullOccludedBlooms` is O(n²) — it compares every bloom against every bloom it has kept — and
 * `shownBlooms` is called from the FRAME LOOP, once per plot, to decide where to draw the hover
 * ring. Measured on the real function: 100 blooms costs 0.17ms, 400 costs 1.19ms, 800 costs
 * 3.69ms. Times nine plots that is 1.5ms, 10.7ms and 33.2ms PER FRAME against a 16.7ms budget,
 * so a garden of well-bred flowery plants falls off 60fps purely to draw a ring.
 *
 * The cull is a pure function of the plant's geometry and how far it has grown. It does not
 * depend on the pointer, so recomputing it sixty times a second was never necessary. This is
 * the same fix, and the same WeakMap-on-Plant shape, that `paintPlantCached` already applies to
 * the PICTURE for the same reason.
 *
 * Keyed on the count of open blooms rather than on the tick: the open set grows MONOTONICALLY
 * with age (every bloom has a fixed tick), so an equal count means an identical set. That makes
 * the check O(n) instead of O(n²), and it stays correct when the clock is driven backwards by
 * `__seek` — a shrinking set changes the count and recomputes.
 */
const culled = new WeakMap<Plant, { count: number; blooms: Bloom[] }>();

/**
 * Blooms a plant is currently SHOWING.
 *
 * Two filters, and both matter. `cullOccludedBlooms` is what the renderer draws, so hit
 * testing anything else would let the player click a flower that is not on screen. The tick
 * filter stops a click landing on a flower that has not opened yet.
 */
export function shownBlooms(p: Planting, now: number): Bloom[] {
  const age = now - p.plantedAt;
  const open = p.plant.blooms.filter((b) => b.tick <= age);
  const hit = culled.get(p.plant);
  if (hit && hit.count === open.length) return hit.blooms;
  const blooms = cullOccludedBlooms(open);
  culled.set(p.plant, { count: open.length, blooms });
  return blooms;
}

/**
 * The bloom under a point, or null.
 *
 * Picks the CLOSEST centre among all hits rather than the first. With overlapping canopies
 * the first match is whichever plot happens to come first in the array, which makes clicking
 * a crowded bed feel arbitrary.
 */
/**
 * Maps a canvas point into one plot's own space.
 *
 * Passed in rather than imported so hit-testing stays free of the renderer. Plots are drawn at
 * different DEPTHS — scaled about their base and lifted — and at the far end that is a 14%
 * shrink and a 13px rise, several times a flower's click slack. Without the inverse, clicking
 * a flower where it appears would miss it entirely, which is worse than having no depth.
 */
export type ToPlotSpace = (plotIndex: number, p: Vec2) => Vec2;

export function bloomAt(
  g: Garden,
  p: Vec2,
  now: number,
  slack = 1.15,
  toLocal?: ToPlotSpace,
): BloomHit | null {
  let best: BloomHit | null = null;
  let bestD = Infinity;
  g.plots.forEach((plot, plotIndex) => {
    if (!plot.occupant) return;
    const q = toLocal ? toLocal(plotIndex, p) : p;
    for (const bloom of shownBlooms(plot.occupant, now)) {
      const d = Math.hypot(bloom.center.x - q.x, bloom.center.y - q.y);
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
  // Derived, not fixed at 30. At TRAY_CAP 12 a fixed gap still fits the 360px minimum world —
  // the row spans x=6 to x=354 — so this is not fixing a present bug. It removes the CLIFF: at
  // 14 the row would be 390 wide in a 360 world, and the outermost seeds would sit off-screen,
  // unclickable, with nothing on screen to say why. Deriving it means the cap above can be
  // tuned without anyone having to rediscover that.
  const gap = Math.min(30, (w - 40) / (TRAY_CAP - 1));
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
