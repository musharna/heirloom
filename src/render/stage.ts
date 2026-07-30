import type { Plant, StrokeSegment } from "../types";
import { buildOutline, fillOutline, groupChains, smoothChain } from "./strokes";
import { fillPetal, petalColor, petalGlow, petalPath } from "./petals";

export const PALETTE = {
  ground: "#0d1013",
  vignette: "rgba(0,0,0,0.55)",
  stem: "#4a6b52",
  stemHi: "#6d9175",
  stamen: "#e8c35a",
} as const;

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Fit = { scale: number; dx: number; dy: number };

/** Bounding box over stems and blooms. Blooms count their full radius, not just centres. */
export function plantBounds(plant: Plant): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const s of plant.segments) {
    add(s.x0, s.y0);
    add(s.x1, s.y1);
  }
  for (const b of plant.blooms) {
    add(b.center.x - b.radius, b.center.y - b.radius);
    add(b.center.x + b.radius, b.center.y + b.radius);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Transform that keeps a plant inside w x h with the base sitting near the bottom.
 * Scale is clamped to <= 1 so a compact plant stays visibly smaller than a vigorous one
 * instead of every plant being stretched to fill its panel.
 */
export function fitPlant(plant: Plant, w: number, h: number, pad = 14): Fit {
  const b = plantBounds(plant);
  const bw = Math.max(1e-6, b.maxX - b.minX);
  const bh = Math.max(1e-6, b.maxY - b.minY);
  const scale = Math.min(1, (w - 2 * pad) / bw, (h - 2 * pad) / bh);
  return {
    scale,
    dx: pad + (w - 2 * pad - bw * scale) / 2 - b.minX * scale,
    dy: h - pad - b.maxY * scale,
  };
}

/** Segments whose tick has already elapsed. Drives the growth animation. */
export function visibleSegments(
  plant: Plant,
  untilTick: number,
): StrokeSegment[] {
  return plant.segments.filter((s) => s.tick <= untilTick);
}

export function paintStage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(
    w / 2,
    h * 0.62,
    Math.min(w, h) * 0.15,
    w / 2,
    h * 0.62,
    Math.max(w, h) * 0.75,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, PALETTE.vignette);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function paintPlant(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  untilTick = Infinity,
): void {
  // Stems first, deepest chains behind.
  const chains = groupChains(visibleSegments(plant, untilTick));
  chains.sort((a, b) => (b[0]?.depth ?? 0) - (a[0]?.depth ?? 0));
  for (const chain of chains) {
    const outline = buildOutline(smoothChain(chain, 3));
    fillOutline(
      ctx,
      outline,
      chain[0]!.depth === 0 ? PALETTE.stemHi : PALETTE.stem,
    );
  }

  // Blooms on top. The glow is drawn ONCE per bloom as a soft radial behind the petals,
  // then petals are drawn with no shadow at all. Per-petal shadows compounded: a doubled
  // bloom stacked 27 halos and read as a neon blob with no petal detail.
  ctx.save();
  for (const b of plant.blooms) {
    const halo = ctx.createRadialGradient(
      b.center.x,
      b.center.y,
      b.radius * 0.2,
      b.center.x,
      b.center.y,
      b.radius * 2.1,
    );
    halo.addColorStop(0, petalGlow(b.hueClass, b.white, b.white ? 0.26 : 0.2));
    halo.addColorStop(1, petalGlow(b.hueClass, b.white, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(
      b.center.x - b.radius * 2.2,
      b.center.y - b.radius * 2.2,
      b.radius * 4.4,
      b.radius * 4.4,
    );

    ctx.shadowBlur = 0;
    for (const p of b.petals) {
      const fill = petalColor(b.hueClass, b.white, p.colorDepth);
      // Stronger ink outline: petal edges ARE the line-art of the art direction.
      fillPetal(ctx, petalPath(p), fill, "rgba(20,10,18,0.55)");
    }
    if (b.stamens) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = PALETTE.stamen;
      ctx.fillStyle = PALETTE.stamen;
      ctx.beginPath();
      ctx.arc(
        b.center.x,
        b.center.y,
        Math.max(1.2, b.radius * 0.13),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.shadowBlur = 18;
    }
  }
  ctx.restore();
}
