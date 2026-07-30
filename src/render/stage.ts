import type { Plant, StrokeSegment } from "../types";
import { buildOutline, fillOutline, groupChains, smoothChain } from "./strokes";
import { fillPetal, petalColor, petalPath } from "./petals";

export const PALETTE = {
  ground: "#0d1013",
  vignette: "rgba(0,0,0,0.55)",
  stem: "#25402f",
  stemHi: "#3c6047",
  stamen: "#e8c35a",
} as const;

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

  // Blooms on top, with a soft glow — the "bloom" of the art direction.
  ctx.save();
  ctx.shadowBlur = 18;
  for (const b of plant.blooms) {
    ctx.shadowColor = petalColor(b.hueClass, b.white, 0);
    for (const p of b.petals) {
      const fill = petalColor(b.hueClass, b.white, p.colorDepth);
      fillPetal(ctx, petalPath(p), fill, "rgba(0,0,0,0.35)");
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
