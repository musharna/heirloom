import type { Bloom, Plant, StrokeSegment } from "../types";
import { buildOutline, fillOutline, groupChains, smoothChain } from "./strokes";
import { leafMidrib, leafPath } from "./leaves";
import {
  fillPetal,
  petalColor,
  petalFill,
  petalGlow,
  petalPath,
  petalRim,
} from "./petals";

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
  soil: "#1c2021",
  soilRim: "rgba(150,170,152,0.34)",
  stamen: "#e8c35a",
  leaf: "#35543d",
  leafRim: "rgba(178,212,183,0.5)",
  leafVein: "rgba(190,220,196,0.32)",
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

/**
 * Drop blooms that sit so far inside another bloom that they cannot read as a flower.
 *
 * Every terminated shoot tip produced a bloom, and dense branching put many tips within a
 * few pixels of each other. The overlapping petals merged into an undifferentiated mass
 * while their centre dots stayed visible, fusing into chains — one canopy collapsed ~85
 * centres into 29 blobs, the largest reading as a 20-bead necklace. Culling fixes that at
 * the source and opens the canopy so the branch geometry behind it can be seen.
 *
 * Exported and pure so the rule is testable without a canvas.
 */
export function cullOccludedBlooms(
  blooms: Bloom[],
  minSeparation = 0.62,
): Bloom[] {
  const kept: Bloom[] = [];
  for (const b of blooms) {
    const tooClose = kept.some((k) => {
      const d = Math.hypot(k.center.x - b.center.x, k.center.y - b.center.y);
      return d < Math.max(k.radius, b.radius) * minSeparation;
    });
    if (!tooClose) kept.push(b);
  }
  return kept;
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
  soilTop?: number,
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

  paintSoil(ctx, w, h, soilTop);
}

/**
 * The soil band. Called by paintStage, and called AGAIN after the plant so the stem's flat
 * base is buried in the ground rather than stopping 2px above it in open air.
 *
 * `soilTop` overrides the default line. The garden needs a deep band with room for the seed
 * tray to rest ON the dirt; the lookdev sheet wants the thin default.
 */
export function paintSoil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  soilTop = soilLine(h),
): void {
  // An UNEVEN soil surface, and a taller one. A flat full-width rectangle with a straight
  // top edge was read as a caption strip rather than as ground — correctly, since that is
  // exactly what it looked like. An irregular crest plus a lit rim along it makes it a
  // surface the plant sits on.
  const crest = (x: number): number =>
    soilTop +
    2.6 * Math.sin(x * 0.055) +
    1.5 * Math.sin(x * 0.13 + 1.7) +
    0.9 * Math.sin(x * 0.31 + 0.4);

  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, crest(0));
  for (let x = 1; x <= w; x++) ctx.lineTo(x, crest(x));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = PALETTE.soil;
  ctx.fill();

  // Lit crest line: the ground gets the same light-rim treatment as the plant, so it reads
  // as a surface edge rather than as a colour change.
  ctx.beginPath();
  ctx.moveTo(0, crest(0));
  for (let x = 1; x <= w; x++) ctx.lineTo(x, crest(x));
  ctx.strokeStyle = PALETTE.soilRim;
  ctx.lineWidth = 1.1;
  ctx.stroke();
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

  // Leaves sit above the stems they attach to but below the blooms. Gated by tick like the
  // stems: previously only segments were filtered, so a half-grown plant drew its full
  // complement of leaves and flowers on frame one and only the stems animated.
  for (const lf of plant.leaves) {
    if (lf.tick > untilTick) continue;
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

  // Occluded blooms are DROPPED, not drawn. A bloom whose centre sits inside a kept
  // bloom's disc contributes no readable flower — but it did contribute a centre dot, and
  // those fused into chains: one panel collapsed ~85 centres into 29 blobs, the largest a
  // 20-deep "string of beads" draped across the canopy. Culling also opens the canopy so
  // branch geometry behind it becomes visible.
  // Also gated by tick, so flowers appear as their shoots finish rather than all at once.
  const blooms = cullOccludedBlooms(
    plant.blooms.filter((b) => b.tick <= untilTick),
  );

  // Glow radius and alpha cut hard. At 1.7x radius the halo measured an 18-27px ramp whose
  // pixel area equalled up to 100% of the drawn plant, roughly 20:1 against the 1px rim —
  // so the eye read bloom-haze instead of linework, and every contour fix drowned in it.
  for (const b of blooms) {
    const r = b.radius * 1.15;
    const halo = ctx.createRadialGradient(
      b.center.x,
      b.center.y,
      b.radius * 0.45,
      b.center.x,
      b.center.y,
      r,
    );
    halo.addColorStop(0, petalGlow(b.hueClass, b.white, b.white ? 0.1 : 0.09));
    halo.addColorStop(1, petalGlow(b.hueClass, b.white, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(b.center.x, b.center.y, r, 0, Math.PI * 2);
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
  for (const b of blooms) {
    withBloomTransform(b, () => {
      // A receptacle disc behind the petals, so the middle of a bloom is never a hole in
      // the ground. Doubled blooms previously darkened to a near-black spiral void.
      ctx.fillStyle = petalColor(b.hueClass, b.white, 0.55);
      ctx.beginPath();
      ctx.arc(b.center.x, b.center.y, b.radius * 0.36, 0, Math.PI * 2);
      ctx.fill();

      for (const p of b.petals) {
        // Gradient along the petal axis, not a flat fill. A scanline across a petal used
        // to return one byte-identical colour end to end, which is what made blooms read
        // as vector clip-art. Rim is chosen relative to the fill's lightness, so a pale
        // morph gets a dark outline — a fixed light rim cannot draw a white flower.
        fillPetal(
          ctx,
          petalPath(p),
          petalFill(ctx, p, b.hueClass, b.white),
          petalRim(b.white, p.colorDepth),
        );
      }
    });
  }

  // PASS 3 — centres, AFTER every petal in the plant.
  //
  // Drawing each bloom's centre immediately after its own petals meant the NEXT bloom's
  // petals buried it: measured 4 visible centres against ~13 bloom-sized units, so two
  // thirds of the flowers read as centreless petal piles.
  for (const b of blooms) {
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
