import { mulberry32 } from "../rng";

/**
 * How a retired plant is placed into the background.
 *
 * Derived deterministically from the genome's hash, never from `Math.random()`, because §7
 * regenerates the whole background from a replay list on load rather than storing it as an
 * image. If placement were random the forest would rearrange itself on every reload — the
 * one thing a "portrait of everything you ever bred" must not do.
 */
export type Placement = {
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  blur: number;
};

/**
 * Fraction of a layer's contrast removed each time ANOTHER plant retires on top of it.
 *
 * This is the whole depth mechanism. Rather than tracking a z-order and re-rendering every
 * layer at its own opacity, each retirement washes the accumulated buffer once toward the
 * ground colour and then draws itself at full strength on top. Depth then falls out of how
 * many retirements have happened since — which is exactly what "older flowers fade into the
 * background" means, and it costs one fillRect instead of N re-draws.
 */
export const WASH = 0.055;

/**
 * Contrast remaining in a layer after `n` further retirements.
 *
 * §12 names background muddiness as a known risk: many accumulated layers converging to grey
 * soup. This is the function that decides whether that happens, so it is worth stating
 * explicitly rather than leaving implicit in a fillRect — geometric decay means old layers
 * approach the ground colour instead of piling up as sediment.
 */
export function remainingContrast(n: number): number {
  return (1 - WASH) ** Math.max(0, n);
}

/**
 * Retirements after which a layer is effectively gone (below 5% contrast).
 *
 * The buffer is one fixed-size canvas, so this is not a memory bound — it is the honest
 * answer to "how deep does the forest actually go before the back of it is indistinguishable
 * from the ground".
 */
export function effectiveDepth(): number {
  let n = 0;
  while (remainingContrast(n) > 0.05) n++;
  return n;
}

/**
 * Where a retired plant lands, from its genome hash.
 *
 * Scattered horizontally on purpose. Retiring each plant at the plot it grew in would build a
 * background of six vertical columns — a bar chart of plot usage rather than a forest.
 */
/** Horizontal scatter, as a fraction of world width. 340px of a 1180-wide world. */
export const SCATTER = 0.288;

export function placeRetired(
  genomeKey: number,
  index: number,
  worldW = 1180,
): Placement {
  // Index is mixed in so that retiring the SAME genome twice does not stack two identical
  // silhouettes exactly on top of each other.
  const rand = mulberry32((genomeKey ^ (index * 0x9e3779b1)) >>> 0);
  const depth = rand(); // 0 = just behind the live bed, 1 = far back

  // These ranges were set by LOOKING at the result, not by choosing round numbers. The first
  // pass used alpha 0.58–0.78 and scale 0.78–0.94, and a retired plant then arrived nearly as
  // bright and nearly as large as a living one: the frame read as clutter rather than depth,
  // and the live bed stopped being the subject of its own picture. A background layer has to
  // give up far more than it intuitively seems it should.
  return {
    // Scatter is a FRACTION of the world, not a fixed 340px. A fixed span is 29% of a
    // 1180-wide desktop world but 86% of a 396-wide phone world, so on a phone retired
    // plants were flung clean off the canvas and the background came back genuinely empty —
    // `depth 1, coverage 0`, a layer that had been composited and drawn nowhere.
    dx: (rand() - 0.5) * worldW * SCATTER,
    // Further back sits higher in frame and smaller: a cheap, consistent perspective cue.
    dy: -8 - depth * 30,
    scale: 0.82 - depth * 0.18,
    alpha: 0.5 - depth * 0.22,
    blur: 1.1 + depth * 1.9,
  };
}
