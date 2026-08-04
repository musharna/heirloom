import type { Plant } from "../types";
import { paintPlant, plantBounds } from "./stage";
import { paintPlantGrowing, releaseGrowth } from "./growing";

/**
 * A finished plant is a static picture. Draw it once; blit it afterwards.
 *
 * Measured before this existed: the bed ran at 11 frames per second, and a pass-by-pass
 * profile put 67% of the paint budget in petals alone — 149 blooms per frame, each rebuilding
 * a gradient per petal, on top of 365 stroke outlines for stems and flower stalks. The cost is
 * a direct consequence of §21: inflorescence architecture multiplied the flower count by
 * roughly five, and nothing downstream was rebuilt for it.
 *
 * The observation that fixes it is that none of that work changes. Once a plant has finished
 * growing and its last flower has opened, its geometry is fixed forever — §6 guarantees as
 * much, since growth is a pure function of the genome. Every frame after that was re-deriving
 * an identical image. Rendering it once into an offscreen canvas turns a plant from thousands
 * of path fills into one `drawImage`.
 *
 * The sway transform is applied by the CALLER, to the blit. A shear of a bitmap and a shear of
 * the vector art it came from are not pixel-identical, but at the amplitudes involved — a few
 * pixels at the tip — the difference is well under the linework's own antialiasing.
 */

type Entry = {
  canvas: HTMLCanvasElement;
  /** Where the top-left of the cached image sits in world coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
};

/**
 * Keyed on the Plant OBJECT, so nothing has to remember to invalidate it.
 *
 * A re-grown plant — after a relayout, or a reload — is a new object and therefore a new
 * entry, and the old one is collected with the plant it belonged to. A key of "genome plus
 * position" would have needed exactly the invalidation logic this avoids.
 */
const cache = new WeakMap<Plant, Entry>();

/** Room around the bounding box for halos and rim strokes, which sit outside the geometry. */
const PAD = 26;

/**
 * Draw a plant, using a cached image once it has settled.
 *
 * @param settledTick The tick after which the plant never changes again. Below it the plant is
 *   still growing or its flowers are still opening, and it is drawn the ordinary way — caching
 *   a moving target would mean rebuilding the cache every frame, which is strictly worse than
 *   not caching at all.
 */
export function paintPlantCached(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  untilTick: number,
  settledTick: number,
  dpr = 1,
): void {
  if (untilTick < settledTick) {
    // Still changing, so a still image is useless — but a full repaint every frame is what
    // dropped the bed to ~6.5fps for eight seconds after every planting. `growing.ts` keeps
    // one layer per drawing pass, appends only what has stopped moving, and blits each
    // opening flower from its own bitmap. It reports false when the plant has no usable
    // extent, in which case the direct painter is still correct.
    if (!paintPlantGrowing(ctx, plant, untilTick, dpr))
      paintPlant(ctx, plant, untilTick);
    return;
  }

  // Settled, so the growth layers and every opening-flower bitmap are dead weight — measured
  // at 4.79MB across a six-plant bed at the worst tick.
  //
  // Released on EVERY settled frame, not on the frame the still image happens to be built.
  // Tying it to construction leaks: a plant whose still image already exists can re-enter
  // growth, allocate a fresh set of layers, and never be asked again — measured at 8.6MB still
  // held. `releaseGrowth` costs one failed WeakMap lookup when there is nothing to release,
  // which is the case on all but one frame of a plant's life.
  releaseGrowth(plant);

  let entry: Entry | null | undefined = cache.get(plant);
  if (!entry || entry.dpr !== dpr) {
    entry = render(plant, dpr);
    if (!entry) {
      // No bounds to speak of — an empty plant. Fall back rather than cache a zero-size
      // canvas, which some engines reject outright.
      paintPlant(ctx, plant, untilTick);
      return;
    }
    cache.set(plant, entry);
  }
  ctx.drawImage(entry.canvas, entry.x, entry.y, entry.w, entry.h);
}

/**
 * How an offscreen canvas is obtained.
 *
 * Injectable so the cache can be tested at all. Everything else in the render layer is either
 * pure or thin enough to judge by eye; this is neither — it decides whether a plant is drawn
 * from its geometry or from a stored picture, and getting that wrong shows up as a plant that
 * never finishes growing. A test has to be able to drive it without a browser.
 */
export type CanvasSource = () => HTMLCanvasElement;

let makeCanvas: CanvasSource = () => document.createElement("canvas");

/** Swap the canvas source. Returns the previous one, so a test can put it back. */
export function setCanvasSource(source: CanvasSource): CanvasSource {
  const was = makeCanvas;
  makeCanvas = source;
  return was;
}

function render(plant: Plant, dpr: number): Entry | null {
  const b = plantBounds(plant);
  const w = b.maxX - b.minX + PAD * 2;
  const h = b.maxY - b.minY + PAD * 2;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;

  const canvas = makeCanvas();
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.scale(dpr, dpr);
  // Draw in WORLD coordinates, offset so the bounding box lands inside the canvas. Keeping the
  // plant's own coordinates means `paintPlant` needs no notion of being drawn somewhere else.
  c.translate(-b.minX + PAD, -b.minY + PAD);
  paintPlant(c, plant);

  return { canvas, x: b.minX - PAD, y: b.minY - PAD, w, h, dpr };
}

/** How many plants are currently cached. Exposed for tests and the driver. */
export function cachedCount(plants: Plant[]): number {
  return plants.filter((p) => cache.has(p)).length;
}
