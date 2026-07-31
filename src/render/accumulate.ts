import type { Plant } from "../types";
import { PALETTE, paintPlant } from "./stage";
import { WASH, placeRetired, type Placement } from "./forest";
import { applyPlacement } from "./motion";
import { paintPlantCached } from "./cache";

/**
 * The accumulation buffer — the original's `bitmapData` trick, and the reason this game can
 * show hundreds of past plants at once.
 *
 * A retired plant is composited ONCE into an offscreen canvas and then exists only as pixels.
 * Keeping them as live objects and re-rendering each frame would mean thousands of stroke
 * outlines per frame after an hour of play; here the cost of the whole history is one
 * `drawImage`, whatever the history's size.
 *
 * The trade is that a composited plant can never be changed again — which is precisely what
 * "retired" means, so nothing is given up.
 */
/**
 * Which placement a retirement should use: the reserved one, or a fresh one for this layer.
 *
 * A one-line decision, pulled out as a function because it is the only part of `Forest` that
 * can be tested without a DOM — and it is the part that matters. When a reservation is ignored,
 * the recede animation eases a plant toward one spot in the background and the composite drops
 * it somewhere else, which is visible only in the frame where the two swap over.
 */
export function resolvePlacement(
  at: Placement | undefined,
  genomeKey: number,
  layers: number,
  w: number,
): Placement {
  return at ?? placeRetired(genomeKey, layers, w);
}

export class Forest {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private layers = 0;

  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly dpr = 1,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    const c = this.canvas.getContext("2d");
    if (!c) throw new Error("Forest: 2D context unavailable");
    c.scale(dpr, dpr);
    this.ctx = c;
  }

  /** How many plants have been composited. */
  get depth(): number {
    return this.layers;
  }

  /**
   * Composite a plant into the background, and push everything already there one step back.
   *
   * Order matters: the wash is applied BEFORE the new plant is drawn, so the newcomer arrives
   * at full strength and only later retirements dim it. Washing afterwards would fade a plant
   * on the very frame it retired.
   *
   * @param at Optional placement, when the caller has already reserved one. The recede
   *   animation needs to know where a plant is heading BEFORE it arrives, so it reserves a
   *   placement as the plant leaves the bed; recomputing one here would use a different layer
   *   index by then — several plants can be receding at once — and the animation would ease
   *   toward one spot while the composite landed on another.
   */
  retire(plant: Plant, genomeKey: number, at?: Placement): void {
    const origin = plant.segments[0];
    if (!origin) return;
    const place: Placement = resolvePlacement(at, genomeKey, this.layers, this.w);
    const c = this.ctx;

    // `source-atop` confines the wash to pixels that already exist, so the empty background
    // is not slowly tinted into a rectangle the exact size of the buffer.
    c.save();
    c.globalCompositeOperation = "source-atop";
    c.globalAlpha = WASH;
    c.fillStyle = PALETTE.ground;
    c.fillRect(0, 0, this.w, this.h);
    c.restore();

    // The SAME placement routine the recede animation ends on, so the handover from the last
    // animated frame to this composite is invisible. Two copies of this arithmetic would drift
    // apart and the drift would show as a jump at exactly the moment the player is watching.
    //
    // And the plant goes in as a BLIT, not as vectors. `applyPlacement` sets a blur, and a
    // canvas filter blurs every drawing operation separately — so painting a plant's several
    // hundred paths under one costs seconds, not milliseconds. A soak measured six to nine
    // seconds per retirement, which is a freeze every time the player replaces a plant, and
    // sixty of them in a row when a saved garden's background is rebuilt on load.
    c.save();
    applyPlacement(c, { x: origin.x0, y: origin.y0 }, place);
    paintPlantCached(c, plant, Infinity, -Infinity, this.dpr);
    c.restore();

    this.layers++;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.canvas, 0, 0, this.w, this.h);
  }

  /** Non-ground pixel count, for verifying the buffer actually received something. */
  coverage(): number {
    const { data } = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) n++;
    return n;
  }
}
