import type { Bloom, Plant, StrokeSegment } from "../types";
import {
  OPEN_TICKS,
  bloomsFor,
  chainsFor,
  openingAt,
  paintCentrePass,
  paintHaloPass,
  paintLeafPass,
  paintPetalPass,
  paintStemPass,
  plantBounds,
} from "./stage";

/**
 * Drawing a plant that is still CHANGING.
 *
 * `paintPlantCached` handles a plant that has stopped: one bitmap, one blit. Below the settle
 * tick it used to fall through to a full `paintPlant` on every frame, and that is the whole of
 * the growth-phase cost — measured 170.6ms of a 179.1ms frame, ~6.5fps for about eight seconds
 * after every planting, against 60fps once the same geometry is cached.
 *
 * The fix is not to cache the plant, because the plant is moving. It is to cache each PASS.
 * `paintPlant` is five global passes in a fixed order — stems, leaves, halos, petals, centres —
 * and the boundaries are load-bearing: interleaving halos with petals erases ink contours, and
 * a centre drawn before the next bloom's petals gets buried. Appending new growth into a single
 * bitmap would destroy that order. One layer per pass preserves it exactly, because source-over
 * compositing is associative: drawing into a transparent layer and compositing it equals drawing
 * directly, up to 8-bit quantisation.
 *
 * That quantisation is real and is the accepted cost, and it is LARGER than it first looks.
 * Measured 2026-08-04 with the gate's own instrument, the shipped `paintPlantCached` differs
 * from a direct paint by max 104/255 on 3.68% of channels, mean 0.4257 — and this painter comes
 * in at 105/255, mean 0.4245, which is the same thing.
 *
 * An earlier figure of 3/255 was wrong and is worth recording as wrong: it was measured on a
 * synthetic probe that composited aligned, same-size canvases. Neither painter does that. Both
 * blit an integer-sized bitmap to FRACTIONAL world coordinates — `drawImage(canvas, x, y, w, h)`
 * where x and w are fractional — so the entire image is resampled, and that dominates.
 *
 * Pixel-identical is not achievable here by any design, and sway settles the question anyway:
 * a plant must be painted at rest and sheared as a blit.
 *
 * ## What is baked, and what is redrawn
 *
 * Only what has STOPPED CHANGING is baked, and "stopped" is not the same as "visible":
 *
 * - A **chain** is finished when its last segment has appeared. That is decided against the
 *   whole plant (`chainEnd` below), not against the segments visible so far — a chain that
 *   pauses would otherwise look finished, get baked as a stale prefix, and then grow again.
 * - A **leaf** is finished the moment it appears. `paintLeafPass` takes no tick and leaves have
 *   no entrance animation, so a visible leaf is a final leaf.
 * - A **bloom** is finished only once it has FULLY OPENED, at `OPEN_TICKS` after its tick.
 *   Before that, `openingAt` scales it a little further open every frame. Baking a bloom when
 *   it first becomes visible — which is what an earlier draft of this file's plan said to do —
 *   would freeze it at 0.32 of its size for the rest of the game.
 *
 * Anything still changing is drawn STRAIGHT ONTO THE TARGET, in between the layer blits, at the
 * point in the pass order where it belongs. That needs no transient layers, costs one less
 * clear and one less blit than routing it through one, and is the more faithful of the two:
 * live geometry lands on the canvas without a resampling step.
 *
 * The interleaving is exact rather than approximate. Baked blooms are strictly older than live
 * ones — the drawn set only ever appends (`test/growing.test.ts`) — so "all baked halos, then
 * all live halos, then all baked petals, then all live petals" is the same sequence as "all
 * halos, then all petals" over the whole ordered set.
 */

/** Room around the bounding box for halos and rim strokes, which sit outside the geometry. */
const PAD = 26;

/**
 * The five passes, in the order `paintPlant` draws them.
 *
 * This array IS the correctness argument. Composite them in any other order and the render is
 * wrong in exactly the ways the pass boundaries were introduced to fix.
 */
const PASSES = ["stems", "leaves", "halos", "petals", "centres"] as const;
type PassName = (typeof PASSES)[number];

type Layers = {
  layer: Record<PassName, HTMLCanvasElement>;
  /** Where the top-left of every layer sits in world coordinates, and their shared size. */
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
  /**
   * The `untilTick` the layers are current to. Everything that had finished changing by this
   * tick is already painted into them. `-Infinity` means nothing has been baked yet.
   */
  bakedTick: number;
  /**
   * The tick of each chain's LAST segment, over the whole plant — so "this chain has finished"
   * is a fact about the plant rather than an inference from what happens to be visible.
   */
  chainEnd: Map<number, number>;
};

let makeCanvas: () => HTMLCanvasElement = () =>
  document.createElement("canvas");

/**
 * Swap the canvas source, mirroring `setCanvasSource` in cache.ts. Returns the previous one.
 *
 * Injectable for the same reason: this decides whether a plant is drawn from its geometry or
 * from stored pictures, and a test has to be able to drive it without a browser.
 */
export function setGrowthCanvasSource(
  source: () => HTMLCanvasElement,
): () => HTMLCanvasElement {
  const was = makeCanvas;
  makeCanvas = source;
  return was;
}

/** Keyed on the Plant OBJECT, so nothing has to remember to invalidate it — as in cache.ts. */
const layers = new WeakMap<Plant, Layers>();

/**
 * Allocate one layer per pass, sized to the FINAL plant.
 *
 * `plantBounds` takes no tick, so it already reports the full extent — which is what is wanted.
 * A layer resized mid-growth would have to be repainted from scratch, and never repainting from
 * scratch is the entire point.
 */
function build(plant: Plant, dpr: number): Layers | null {
  const b = plantBounds(plant);
  const w = b.maxX - b.minX + PAD * 2;
  const h = b.maxY - b.minY + PAD * 2;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;

  const layer = {} as Record<PassName, HTMLCanvasElement>;
  for (const name of PASSES) {
    const c = makeCanvas();
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d");
    if (!g) return null;
    // Draw in WORLD coordinates, offset so the bounding box lands inside the canvas — the same
    // convention cache.ts uses, so the passes need no notion of being drawn somewhere else.
    g.scale(dpr, dpr);
    g.translate(-b.minX + PAD, -b.minY + PAD);
    layer[name] = c;
  }

  const chainEnd = new Map<number, number>();
  for (const s of plant.segments) {
    const end = chainEnd.get(s.chain);
    if (end === undefined || s.tick > end) chainEnd.set(s.chain, s.tick);
  }

  return {
    layer,
    x: b.minX - PAD,
    y: b.minY - PAD,
    w,
    h,
    dpr,
    bakedTick: -Infinity,
    chainEnd,
  };
}

/** Wipe a layer without disturbing the world-coordinate transform baked into its context. */
function clear(c: HTMLCanvasElement): void {
  const g = c.getContext("2d");
  if (!g) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.restore();
}

/** A fully open flower. What every baked bloom is drawn at, by definition of being baked. */
const FULLY_OPEN = (): number => 1;

/**
 * The three bloom passes, wrapped exactly as `paintPlant` wraps them.
 *
 * `paintPlant` puts one `save`/`shadowBlur = 0`/`restore` around all three. A single wrapper
 * cannot span three separate layer contexts, so it is applied per context instead — which is
 * equivalent, because the only state it sets is reset the same way each time.
 */
function bloomPasses(
  ctx: CanvasRenderingContext2D,
  blooms: Bloom[],
  opening: (tick: number) => number,
  pass: "halos" | "petals" | "centres",
): void {
  ctx.save();
  ctx.shadowBlur = 0;
  if (pass === "halos") paintHaloPass(ctx, blooms, opening);
  else if (pass === "petals") paintPetalPass(ctx, blooms, opening);
  else paintCentrePass(ctx, blooms, opening);
  ctx.restore();
}

/**
 * Draw a plant that is still growing.
 *
 * Falls back to nothing when the plant has no drawable extent; the caller has already handled
 * the empty-plant case by the time it gets here.
 */
export function paintPlantGrowing(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  untilTick: number,
  dpr = 1,
): void {
  let ls = layers.get(plant);
  if (!ls || ls.dpr !== dpr) {
    const built = build(plant, dpr);
    if (!built) return;
    ls = built;
    layers.set(plant, ls);
  }

  // Growth only runs forwards. A caller that steps BACKWARDS — a test sweeping ticks, the
  // fidelity probe re-rendering the same plant at tick 20 after tick 140 — would otherwise be
  // handed layers holding growth that has not happened yet. Start over rather than serve that.
  if (untilTick < ls.bakedTick) {
    for (const name of PASSES) clear(ls.layer[name]);
    ls.bakedTick = -Infinity;
  }

  const from = ls.bakedTick;
  const opening = (tick: number): number => openingAt(untilTick, tick);
  const ctxOf = (name: PassName): CanvasRenderingContext2D =>
    ls.layer[name].getContext("2d") as CanvasRenderingContext2D;

  // ---- STEMS ---------------------------------------------------------------------------
  // A chain still growing cannot be appended to: its outline is rebuilt from the whole
  // smoothed chain every frame, so drawing the new part alone would leave a seam and drawing
  // the whole thing again would double-paint. Finished chains are baked once; the rest are
  // redrawn live.
  const live: StrokeSegment[][] = [];
  const newlyFinished: StrokeSegment[][] = [];
  for (const chain of chainsFor(plant, untilTick)) {
    const end = ls.chainEnd.get(chain[0]!.chain) ?? -Infinity;
    if (end > untilTick) live.push(chain);
    else if (end > from) newlyFinished.push(chain);
  }
  if (newlyFinished.length) paintStemPass(ctxOf("stems"), plant, newlyFinished);

  // ---- LEAVES --------------------------------------------------------------------------
  const newLeaves = plant.leaves.filter(
    (lf) => lf.tick > from && lf.tick <= untilTick,
  );
  if (newLeaves.length) paintLeafPass(ctxOf("leaves"), plant, newLeaves);

  // ---- BLOOMS --------------------------------------------------------------------------
  // The threshold is the tick at which a flower has FINISHED opening, not the tick it appears.
  const blooms = bloomsFor(plant, untilTick);
  const openedBy = untilTick - OPEN_TICKS;
  const openedBefore = from - OPEN_TICKS;
  const newlyOpen = blooms.filter(
    (b) => b.tick > openedBefore && b.tick <= openedBy,
  );
  const opening_ = blooms.filter((b) => b.tick > openedBy);
  if (newlyOpen.length)
    for (const pass of ["halos", "petals", "centres"] as const)
      bloomPasses(ctxOf(pass), newlyOpen, FULLY_OPEN, pass);

  ls.bakedTick = untilTick;

  // ---- COMPOSITE -----------------------------------------------------------------------
  // Each layer, then whatever is still moving in that pass, at the pass's own position.
  const blit = (name: PassName): void => {
    ctx.drawImage(ls.layer[name], ls.x, ls.y, ls.w, ls.h);
  };
  blit("stems");
  if (live.length) paintStemPass(ctx, plant, live);
  blit("leaves");
  for (const pass of ["halos", "petals", "centres"] as const) {
    blit(pass);
    if (opening_.length) bloomPasses(ctx, opening_, opening, pass);
  }
}

/** Drop a plant's layers. Called once it settles and the still-image cache takes over. */
export function releaseGrowth(plant: Plant): void {
  layers.delete(plant);
}

/** Approximate bytes held for one plant's layers. For the memory assertion in the driver. */
export function growingLayerBytes(plant: Plant): number {
  const ls = layers.get(plant);
  if (!ls) return 0;
  return PASSES.reduce(
    (n, name) => n + ls.layer[name].width * ls.layer[name].height * 4,
    0,
  );
}

/** How many plants currently hold growth layers. Exposed for tests and the driver. */
export function growingCount(plants: Plant[]): number {
  return plants.filter((p) => layers.has(p)).length;
}
