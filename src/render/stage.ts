import type { Plant, StrokeSegment } from "../types";
import { buildOutline, fillOutline, groupChains, smoothChain } from "./strokes";
import { leafMidrib, leafPath } from "./leaves";
import { fillPetal, petalColor, petalGlow, petalPath } from "./petals";

/**
 * Silhouette lines are LIGHT, not dark.
 *
 * "Ink line-art on a dark ground" is self-contradictory if the ink is dark: a near-black
 * contour on a near-black ground is invisible by construction. Measured proof from the
 * round-3 critique — a stem scanline read ground [12,15,17] -> fill [109,145,117] ->
 * [24,36,28] -> ground: the contour WAS rendering, at 1px, and could not be seen. Making
 * it darker and more opaque (the round-3 attempt) moved it in exactly the wrong direction.
 *
 * Line art on a dark surface works the way chalk does: the line is lighter than the
 * surface. These rim colours are what separate a silhouette from the ground.
 */
export const PALETTE = {
  ground: "#0d1013",
  vignette: "rgba(0,0,0,0.55)",
  stem: "#3d5c46",
  stemHi: "#557a5f",
  stemRim: "rgba(196,224,201,0.55)",
  soil: "#171b1c",
  stamen: "#e8c35a",
  leaf: "#35543d",
  leafRim: "rgba(178,212,183,0.5)",
  leafVein: "rgba(190,220,196,0.32)",
  petalRim: "rgba(255,228,220,0.62)",
  // Dark line kept ONLY for divisions between overlapping petals, where the surface
  // behind the line is a lit petal rather than the dark ground.
  petalDivide: "rgba(48,14,26,0.55)",
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
  // Leaves count too, or a leafy plant would be fitted as though it were a bare stem and
  // its foliage would hang outside the frame.
  for (const lf of plant.leaves) {
    add(lf.attach.x, lf.attach.y);
    add(
      lf.attach.x + Math.cos(lf.angle) * lf.length,
      lf.attach.y + Math.sin(lf.angle) * lf.length,
    );
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

  paintSoil(ctx, w, h);
}

/**
 * The soil band. Called by paintStage, and called AGAIN after the plant so the stem's flat
 * base is buried in the ground rather than stopping 2px above it in open air.
 */
export function paintSoil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const soilTop = soilLine(h);
  ctx.fillStyle = PALETTE.soil;
  ctx.fillRect(0, soilTop, w, h - soilTop);
  const edge = ctx.createLinearGradient(0, soilTop - 7, 0, soilTop + 2);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, soilTop - 7, w, 9);
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
      ctx.strokeStyle = PALETTE.stemRim;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // Leaves sit above the stems they attach to but below the blooms.
  for (const lf of plant.leaves) {
    const pts = leafPath(lf);
    if (pts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.closePath();
    ctx.fillStyle = PALETTE.leaf;
    ctx.fill();
    ctx.strokeStyle = PALETTE.leafRim;
    ctx.lineWidth = 1;
    ctx.stroke();

    const [a, b] = leafMidrib(lf);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = PALETTE.leafVein;
    ctx.lineWidth = 0.7;
    ctx.stroke();
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

  // Per-bloom foreshortening transform, shared by the petal and centre passes.
  const withBloomTransform = (
    b: (typeof plant.blooms)[number],
    draw: () => void,
  ): void => {
    ctx.save();
    // Nodding foreshortening: a bloom on a downward-pointing shoot is seen obliquely, so
    // squash it across the shoot axis. Without this every bloom faced the viewer dead-on
    // and a weeping plant's flowers read as merely positioned low, not as pendant.
    const squash = 1 - 0.45 * b.tilt;
    ctx.translate(b.center.x, b.center.y);
    ctx.scale(1, squash);
    ctx.translate(-b.center.x, -b.center.y);
    draw();
    ctx.restore();
  };

  // PASS 2 — petals for every bloom.
  //
  // NOTE: sepals are deliberately NOT drawn. A calyx was added here to fill the gaps
  // between petals, and it backfired badly: on a front-facing open flower the sepals are
  // hidden in reality, so drawing them inserted hard green wedges exactly where
  // petal-on-petal overlap should be, which ENTRENCHED the pinwheel read it was meant to
  // cure. Bloom.sepals is still generated for a future profile/bud view.
  for (const b of plant.blooms) {
    withBloomTransform(b, () => {
      // A receptacle disc behind the petals, so the middle of a bloom is never a hole in
      // the ground. Doubled blooms previously darkened to a near-black spiral void.
      ctx.fillStyle = petalColor(b.hueClass, b.white, 0.55);
      ctx.beginPath();
      ctx.arc(b.center.x, b.center.y, b.radius * 0.36, 0, Math.PI * 2);
      ctx.fill();

      for (const p of b.petals) {
        const fill = petalColor(b.hueClass, b.white, p.colorDepth);
        // LIGHT rim, not dark ink — see the PALETTE comment. A dark contour on a dark
        // ground rendered correctly and was still invisible.
        fillPetal(ctx, petalPath(p), fill, PALETTE.petalRim);
      }
    });
  }

  // PASS 3 — centres, AFTER every petal in the plant.
  //
  // Drawing each bloom's centre immediately after its own petals meant the NEXT bloom's
  // petals buried it: measured 4 visible centres against ~13 bloom-sized units, so two
  // thirds of the flowers read as centreless petal piles.
  for (const b of plant.blooms) {
    withBloomTransform(b, () => {
      if (b.stamens) {
        ctx.fillStyle = PALETTE.stamen;
        ctx.beginPath();
        ctx.arc(
          b.center.x,
          b.center.y,
          Math.max(1.8, b.radius * 0.18),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else {
        // Doubles convert stamens to petals (ABC C-function), so no stamen boss — but the
        // furled centre still catches light, and it keeps the yellow eye language.
        ctx.fillStyle = PALETTE.stamen;
        ctx.beginPath();
        ctx.arc(
          b.center.x,
          b.center.y,
          Math.max(1.4, b.radius * 0.12),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.strokeStyle = PALETTE.petalDivide;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    });
  }
  ctx.restore();
}
