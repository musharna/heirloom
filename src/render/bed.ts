/**
 * Where each plot sits in DEPTH, and what that does to the plant standing in it.
 *
 * The accumulating forest has had depth since milestone 4 — layers recede by scale, alpha and
 * blur — while the bed the player actually works in has been a single flat plane. Measured on
 * the live render with one genome planted in every plot, so genetics could not be mistaken for
 * position: nothing about a plant's appearance said where it was, and where two plants
 * overlapped they interpenetrated rather than one occluding the other.
 *
 * Everything here is PAINT-TIME, like the sway. Depth is a property of the plot, not the plant:
 * the same genome planted in a nearer plot is the same plant, drawn nearer.
 */

export type BedDepth = {
  /** 0 = nearest the viewer, 1 = furthest back. */
  depth: number;
  scale: number;
  /** Vertical offset. Further back sits higher in frame, as it does in the forest. */
  dy: number;
  /** Blended toward the ground, which dims AND desaturates in one operation. */
  alpha: number;
};

/**
 * Depth range for the bed. Deliberately much shallower than the forest's.
 *
 * The forest runs scale 0.82–0.64 at alpha 0.50–0.28. The bed's FURTHEST plant has to stay
 * clearly in front of the forest's NEAREST layer, or the two read as one continuous field and
 * the distinction the whole background mechanic rests on collapses. So the bed occupies a
 * narrow band near the front, and the gap between 0.86 and 0.82 is what keeps the live plants
 * legible as the subject.
 */
const NEAR = { scale: 1, dy: 0, alpha: 1 };
const FAR = { scale: 0.86, dy: -13, alpha: 0.84 };

/**
 * How far back each plot sits.
 *
 * NOT monotonic left to right. A bed that recedes steadily across the frame reads as a ramp —
 * the eye takes it for a perspective grid rather than for plants at different distances. A
 * border planting has near and far interleaved, so the golden-ratio sequence is used to spread
 * the values without any two adjacent plots landing close together.
 *
 * Deterministic in the plot INDEX, so a plot's depth never changes under the player: the plant
 * in the third plot is at the same distance this session as last.
 */
export function plotDepth(plotIndex: number): number {
  return (plotIndex * 0.6180339887498949 + 0.31) % 1;
}

export function bedDepth(plotIndex: number): BedDepth {
  const depth = plotDepth(plotIndex);
  return {
    depth,
    scale: NEAR.scale + (FAR.scale - NEAR.scale) * depth,
    dy: NEAR.dy + (FAR.dy - NEAR.dy) * depth,
    alpha: NEAR.alpha + (FAR.alpha - NEAR.alpha) * depth,
  };
}

/**
 * Plot indices ordered furthest-first, so nearer plants paint over further ones.
 *
 * This is the whole point of having depth at all. Without an order, two overlapping plants
 * interleave according to array position and neither reads as being in front.
 */
export function paintOrder(plots: number): number[] {
  return Array.from({ length: plots }, (_, i) => i).sort(
    (a, b) => plotDepth(b) - plotDepth(a),
  );
}

/**
 * Map a canvas point into a plot's own space, so hit-testing agrees with what was drawn.
 *
 * Depth scales a plant about its base and lifts it. At the far end that is a 14% shrink and a
 * 13px rise — far more than a flower's click slack — so without the inverse, clicking a flower
 * where it appears would miss it. The sway is left out deliberately: it is a couple of pixels
 * and it MOVES, so folding it in would make a click land differently depending on when it
 * happened.
 */
export function toPlotSpace(
  p: { x: number; y: number },
  base: { x: number; y: number },
  d: BedDepth,
): { x: number; y: number } {
  return {
    x: base.x + (p.x - base.x) / d.scale,
    y: base.y + (p.y - base.y - d.dy) / d.scale,
  };
}

/** The inverse: where a point in a plant's own space is actually drawn. */
export function toCanvasSpace(
  p: { x: number; y: number },
  base: { x: number; y: number },
  d: BedDepth,
): { x: number; y: number } {
  return {
    x: base.x + (p.x - base.x) * d.scale,
    y: base.y + (p.y - base.y) * d.scale + d.dy,
  };
}
