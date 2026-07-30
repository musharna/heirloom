import type { Plant, StrokeSegment } from "../types";
import { buildOutline, fillOutline, groupChains, smoothChain } from "./strokes";
import { fillPetal, petalColor, petalGlow, petalPath } from "./petals";

export const PALETTE = {
  ground: "#0d1013",
  vignette: "rgba(0,0,0,0.55)",
  stem: "#4a6b52",
  stemHi: "#6d9175",
  stemInk: "rgba(10,20,14,0.65)",
  soil: "#171b1c",
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
  const soil = soilLine(h);
  const origin = plant.segments[0];
  const originY = origin?.y0 ?? 0;

  // Scale against the extent ABOVE the origin, not the full bounding box. The base is
  // always seated on the soil, so only the part that rises has to fit the open frame;
  // whatever droops below the origin drapes onto the soil band, which is how a weeping
  // plant actually rests. Scaling on full height instead forced the whole plant upward
  // and lifted its base off the ground.
  const above = Math.max(1e-6, originY - b.minY);
  const scale = Math.min(1, (w - 2 * pad) / bw, (soil - pad) / above);

  let dx = w / 2 - (origin?.x0 ?? 0) * scale;
  const dy = soil - originY * scale;

  // Nudge horizontally if the plant leans past an edge. Vertical seating is not adjusted:
  // the base belongs on the ground.
  const minX = b.minX * scale + dx;
  const maxX = b.maxX * scale + dx;
  if (minX < pad) dx += pad - minX;
  else if (maxX > w - pad) dx -= maxX - (w - pad);

  return { scale, dx, dy };
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

  // A soil band, so a plant reads as rooted rather than as a cut stem hung in black.
  const soilTop = h - Math.max(10, h * 0.045);
  ctx.fillStyle = PALETTE.soil;
  ctx.fillRect(0, soilTop, w, h - soilTop);
  const edge = ctx.createLinearGradient(0, soilTop - 6, 0, soilTop + 2);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, soilTop - 6, w, 8);
}

/** Where paintStage puts the soil surface. Plants should be seated on this line. */
export function soilLine(h: number): number {
  return h - Math.max(10, h * 0.045);
}

export function paintPlant(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  untilTick = Infinity,
): void {
  // Stems first, deepest chains behind. Each carries an ink contour: the art direction
  // applies to stems as well as petals, and previously only petals were outlined.
  const chains = groupChains(visibleSegments(plant, untilTick));
  chains.sort((a, b) => (b[0]?.depth ?? 0) - (a[0]?.depth ?? 0));
  for (const chain of chains) {
    const outline = buildOutline(smoothChain(chain, 3));
    fillOutline(
      ctx,
      outline,
      chain[0]!.depth === 0 ? PALETTE.stemHi : PALETTE.stem,
    );
    if (outline.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(outline[0]!.x, outline[0]!.y);
      for (let i = 1; i < outline.length; i++)
        ctx.lineTo(outline[i]!.x, outline[i]!.y);
      ctx.closePath();
      ctx.strokeStyle = PALETTE.stemInk;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  // Blooms in TWO passes: every halo first, then every petal.
  //
  // Interleaving them (halo, petals, halo, petals...) meant a later bloom's halo was
  // composited OVER an earlier bloom's petals, erasing its ink contour and turning
  // overlapping blooms into washed-out mush where you could not tell which was in front.
  ctx.save();
  ctx.shadowBlur = 0;
  for (const b of plant.blooms) {
    const halo = ctx.createRadialGradient(
      b.center.x,
      b.center.y,
      b.radius * 0.2,
      b.center.x,
      b.center.y,
      b.radius * 1.7,
    );
    halo.addColorStop(0, petalGlow(b.hueClass, b.white, b.white ? 0.2 : 0.17));
    halo.addColorStop(1, petalGlow(b.hueClass, b.white, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(b.center.x, b.center.y, b.radius * 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const b of plant.blooms) {
    // A receptacle disc behind the petals, so the middle of a bloom is never a hole in
    // the ground. Doubled blooms previously darkened to a near-black spiral void.
    ctx.fillStyle = petalColor(b.hueClass, b.white, 0.35);
    ctx.beginPath();
    ctx.arc(b.center.x, b.center.y, b.radius * 0.34, 0, Math.PI * 2);
    ctx.fill();

    for (const p of b.petals) {
      const fill = petalColor(b.hueClass, b.white, p.colorDepth);
      // Stronger ink outline: petal edges ARE the line-art of the art direction.
      fillPetal(ctx, petalPath(p), fill, "rgba(20,10,18,0.55)");
    }

    // Singles show a stamen boss. Doubles convert stamens to petals (ABC C-function), so
    // they get a lit furled centre instead — biology preserved, but no black void.
    if (b.stamens) {
      ctx.fillStyle = PALETTE.stamen;
      ctx.beginPath();
      ctx.arc(
        b.center.x,
        b.center.y,
        Math.max(1.4, b.radius * 0.15),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    } else {
      ctx.fillStyle = petalColor(b.hueClass, b.white, 0);
      ctx.beginPath();
      ctx.arc(
        b.center.x,
        b.center.y,
        Math.max(1.2, b.radius * 0.12),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}
