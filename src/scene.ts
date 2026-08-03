/**
 * The garden scene, painted once and shared by everything that shows a garden.
 *
 * This is the picture and nothing else: sky, background forest, plants receding into it, the
 * swaying bed, soil and contact shadows. It stops there deliberately. Plot markers, the
 * inspection ring, insects, the hover halo, the tray and the drag tether are all INTERACTION
 * CHROME and stay with the game — a read-only visit that painted "a seed can go here" would be
 * offering an affordance that does nothing.
 *
 * Two clocks, and that is the point of the signature. `now` drives growth, `motionNow` drives
 * sway and the recede animation. In the game they are the same value; in a visit `now` is
 * pinned and `motionNow` keeps running, which is how "frozen growth, living motion" is
 * expressed. One clock parameter could not say it.
 */
import type { Genome } from "./genome/genome";
import { genomeSeed } from "./genome/serialize";
import { express } from "./genome/express";
import { Forest } from "./render/accumulate";
import { paintPlantCached } from "./render/cache";
import {
  RECEDE_TICKS,
  applyPlacement,
  applySway,
  lerpPlacement,
  swayAt,
} from "./render/motion";
import type { Placement } from "./render/forest";
import { bedDepth, paintOrder } from "./render/bed";
import { paintContactShadow, paintSoil, paintStage } from "./render/stage";
import type { Plant } from "./types";

/**
 * Ticks after a plant's last segment before it is treated as finished.
 *
 * Comfortably past OPEN_TICKS, because a flower that was still opening when its image was
 * cached would stay half-open for as long as the plant stands there.
 */
const SETTLE_TICKS = 40;

export type SceneOccupant = {
  genome: Genome;
  plant: Plant;
  plantedAt: number;
  maxTick: number;
};

export type SceneReceding = {
  plant: Plant;
  key: number;
  place: Placement;
  start: number;
};

export type Scene = {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  SOIL: number;
  dpr: number;
  forest: Forest;
  /** One entry per plot, null where bare. Length is the plot count. */
  occupants: (SceneOccupant | null)[];
  receding: SceneReceding[];
  /** Growth clock. Frozen in a visit. */
  now: number;
  /** Motion clock. Always advancing, in both entries. */
  motionNow: number;
  stageCache: HTMLCanvasElement | null;
};

/**
 * Draw a living plant, bending.
 *
 * The sway is a canvas transform wrapped around the ordinary paint call, so `paintPlant` knows
 * nothing about it and every part of the plant — stems, leaves, flowers, and the gradients
 * inside them — bends together for the cost of one matrix. It also means the plant a
 * retirement composites into the background is the RESTING one: `forest.retire` calls
 * `paintPlant` directly, so a plant cannot be frozen into the picture mid-lean.
 *
 * Stiffness comes from the phenotype, so a weeping plant moves like one.
 */
function paintSwaying(s: Scene, occ: SceneOccupant, plotIndex: number): void {
  const base = occ.plant.segments[0];
  const k = base
    ? swayAt(s.motionNow, genomeSeed(occ.genome), base.x0, s.W, {
        stiffness: express(occ.genome).stiffness,
      })
    : 0;
  const d = bedDepth(plotIndex);
  s.ctx.save();
  if (base) {
    // Depth first, then sway: the sway is a property of the plant, so it should be scaled by
    // distance along with everything else rather than being applied at full size on top.
    s.ctx.translate(base.x0, base.y0 + d.dy);
    s.ctx.scale(d.scale, d.scale);
    s.ctx.translate(-base.x0, -base.y0);
    // Blended toward the ground, which dims and desaturates in one operation — the same cue
    // the background forest uses, at a fraction of the strength.
    s.ctx.globalAlpha = d.alpha;
    applySway(s.ctx, k, base.y0);
  }
  // Cached once the plant has stopped changing. `maxTick` is when the last SEGMENT is drawn;
  // flowers keep opening for a while after that, so the settle point is later than "grown".
  paintPlantCached(
    s.ctx,
    occ.plant,
    s.now - occ.plantedAt,
    occ.maxTick + SETTLE_TICKS,
    s.dpr,
  );
  s.ctx.restore();
}

/**
 * The sky, painted once.
 *
 * `paintStage` is three full-canvas operations — a fill, a horizon gradient and a vignette —
 * and not one pixel of it changes between frames. Repainting it sixty times a second cost
 * roughly a fifth of the frame rate on a throttled phone: measured 20-26fps before the depth
 * work added the horizon and 16-19 after, on the same device.
 *
 * Same reasoning as the plant cache, and the same shape: if it cannot change, draw it once.
 * Invalidated only by a relayout, which is the one thing that changes its size.
 *
 * The cache lives in the CALLER — returned rather than held here — so this module stays
 * stateless and two gardens on one page cannot fight over one sky.
 */
function drawStage(s: Scene): HTMLCanvasElement | null {
  let stageCache = s.stageCache;
  if (!stageCache) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(s.W * s.dpr));
    c.height = Math.max(1, Math.round(s.H * s.dpr));
    const g = c.getContext("2d");
    if (!g) {
      // Fail soft: a missing offscreen context should cost frame rate, not the sky.
      paintStage(s.ctx, s.W, s.H, s.SOIL);
      return null;
    }
    g.scale(s.dpr, s.dpr);
    paintStage(g, s.W, s.H, s.SOIL);
    stageCache = c;
  }
  s.ctx.drawImage(stageCache, 0, 0, s.W, s.H);
  return stageCache;
}

/**
 * Paint the whole scene, and hand back the stage cache to hold until the next frame.
 */
export function drawScene(s: Scene): HTMLCanvasElement | null {
  const stageCache = drawStage(s);
  s.forest.draw(s.ctx);

  // Between the background and the bed, which is exactly where a plant on its way from one to
  // the other belongs.
  for (const r of s.receding) {
    const origin = r.plant.segments[0];
    if (!origin) continue;
    s.ctx.save();
    applyPlacement(
      s.ctx,
      { x: origin.x0, y: origin.y0 },
      lerpPlacement(r.place, (s.motionNow - r.start) / RECEDE_TICKS),
    );
    // Blur ONE blit, not several hundred path fills.
    //
    // `applyPlacement` sets `ctx.filter = blur(...)`, and a canvas filter forces every
    // subsequent drawing operation into its own layer to be blurred separately. Painting the
    // plant as vectors under it cost 765ms per frame — measured — which dropped the whole
    // garden to two frames a second for the length of the animation, and stopped the recede
    // finishing at all. A receding plant has by definition finished growing, so it always has
    // a cached picture; blurring that is one operation.
    paintPlantCached(s.ctx, r.plant, Infinity, -Infinity, s.dpr);
    s.ctx.restore();
  }

  // Furthest plot first, so a nearer plant paints OVER a further one. Without an order two
  // overlapping plants interleave by array position and neither reads as being in front — which
  // is what the bed did before it had any depth at all.
  for (const i of paintOrder(s.occupants.length)) {
    const occ = s.occupants[i];
    if (occ) paintSwaying(s, occ, i);
  }
  paintSoil(s.ctx, s.W, s.H, s.SOIL);

  // Contact shadows go on top of the SOIL, which is why they are here and not with the plants.
  //
  // Drawn before the plants they were invisible: `paintSoil` runs last so a stem's flat base is
  // buried in the ground rather than stopping in mid-air, and it painted straight over every
  // shadow. Measured 0.5 units of darkening under a stem against 0.4 without them — which is
  // to say the feature was doing nothing at all.
  //
  // A separate pass rather than one per plant inside the loop above: each would otherwise land
  // on top of the plant drawn before it, so a nearer plant's shadow would sit over a further
  // plant's stem. Same reason the bloom halos are their own pass.
  for (const i of paintOrder(s.occupants.length)) {
    const occ = s.occupants[i];
    const b = occ?.plant.segments[0];
    if (!occ || !b) continue;
    const d = bedDepth(i);
    s.ctx.save();
    s.ctx.globalAlpha = d.alpha;
    paintContactShadow(s.ctx, b.x0, b.y0 + d.dy, b.w0 * d.scale);
    s.ctx.restore();
  }

  return stageCache;
}
