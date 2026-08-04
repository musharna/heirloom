import type { Plant } from "../types";
import {
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
 * That quantisation is real and is the accepted cost. Routing any drawing through an offscreen
 * surface differs from a direct paint by up to 3/255 on ~11% of channels, measured with a
 * control that used ONE intermediate canvas and no pass-splitting — so it is intrinsic to
 * compositing, not to this architecture. `paintPlantCached` has always paid it for settled
 * plants. Pixel-identical is not achievable here by any design, and sway settles the question
 * anyway: a plant must be painted at rest and sheared as a blit.
 *
 * This file is deliberately NOT incremental yet. It proves the layering is faithful first.
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
  return { layer, x: b.minX - PAD, y: b.minY - PAD, w, h, dpr };
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

  const opening = (tick: number): number => openingAt(untilTick, tick);
  const blooms = bloomsFor(plant, untilTick);
  const ctxOf = (name: PassName): CanvasRenderingContext2D =>
    ls.layer[name].getContext("2d") as CanvasRenderingContext2D;

  for (const name of PASSES) clear(ls.layer[name]);

  paintStemPass(ctxOf("stems"), plant, chainsFor(plant, untilTick));
  paintLeafPass(
    ctxOf("leaves"),
    plant,
    plant.leaves.filter((lf) => lf.tick <= untilTick),
  );
  // The save/shadowBlur wrapper that `paintPlant` puts around all three bloom passes is applied
  // per layer here. Each layer is a separate context, so a single wrapper could not span them.
  for (const [name, pass] of [
    ["halos", paintHaloPass],
    ["petals", paintPetalPass],
    ["centres", paintCentrePass],
  ] as const) {
    const g = ctxOf(name);
    g.save();
    g.shadowBlur = 0;
    pass(g, blooms, opening);
    g.restore();
  }

  for (const name of PASSES)
    ctx.drawImage(ls.layer[name], ls.x, ls.y, ls.w, ls.h);
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
