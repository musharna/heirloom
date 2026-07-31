import type { Bloom, Plant, StrokeSegment } from "../types";
import {
  LIGHT,
  buildOutline,
  fillOutline,
  groupChains,
  smoothChain,
} from "./strokes";
import { leafMidrib, leafPath, leafVeins } from "./leaves";
import { ease } from "./motion";
import {
  fillPetal,
  paintPetal,
  petalColor,
  petalFill,
  petalGlow,
  petalPath,
  petalRim,
  petalRimWidth,
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
  /**
   * An albino seedling — `ll`, no chlorophyll at all.
   *
   * Cream rather than a desaturated green, because a desaturated green reads as "drawn in
   * poor light" and the player would take it for a rendering fault. Cream against the dark
   * ground reads as a specific condition of the plant, which is what it is. The shade and
   * highlight strips are translucent, so they shade this pair as they do the green one and
   * nothing else in the paint path needs to know.
   */
  stemAlbino: "#c3b98a",
  stemAlbinoHi: "#ded4a2",
  stemAlbinoRim: "rgba(250,244,206,0.6)",
  /** Cotyledons on an albino seedling — the same cream, a shade lighter than its stem. */
  leafAlbino: "#cec48f",
  leafAlbinoLit: "#e6dcaa",
  // Translucent, not opaque, so one pair of tones shades BOTH stem colours. Opaque bands
  // would need a matched pair per base colour, and every future colour would need two more.
  stemShade: "rgba(12,24,16,0.26)",
  stemLit: "rgba(206,234,210,0.11)",
  soil: "#1c2021",
  /**
   * The far edge of the receding ground band.
   *
   * Darker and cooler than the near soil: aerial perspective, and the only thing distinguishing
   * a plant standing further back from one hovering.
   */
  soilFar: "#12171a",
  /** Bottom of the soil gradient — earth falls off with depth rather than reading as a slab. */
  soilDeep: "#101315",
  soilRim: "rgba(150,170,152,0.34)",
  stamen: "#e8c35a",
  leaf: "#2d4a35",
  /** Lit edge of a blade. Paired with `leaf` as a gradient, never used alone. */
  leafLit: "#456a4e",
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

  // A HORIZON, faintly.
  //
  // The sky was one flat colour, which gave the eye nothing to place the bed against: plants
  // stood in front of an even field rather than in a space. A slow lift toward the ground line
  // reads as distance behind them — the same trick a stage cyclorama uses, and for the same
  // reason. Kept very quiet: this is a dark game, and anything more turns into a sunset.
  const line = soilTop ?? soilLine(h);
  const sky = ctx.createLinearGradient(0, Math.max(0, line - h * 0.62), 0, line);
  sky.addColorStop(0, "rgba(94,126,140,0)");
  sky.addColorStop(0.72, "rgba(94,126,140,0.045)");
  sky.addColorStop(1, "rgba(120,150,158,0.085)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, line);

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
/**
 * How far the ground reaches back behind the near crest, in px.
 *
 * Matched to the bed's deepest plot: whatever the furthest plant is lifted by, there has to be
 * ground under it. Set here rather than imported from `bed.ts` because the renderer must not
 * depend on the game's plot layout — but a test pins the two together, since the failure if
 * they drift is a plant standing on nothing.
 */
export const RECEDE_BAND = 16;

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

  // GROUND THAT RECEDES, above the near crest.
  //
  // The bed lifts a further-back plant to sit higher in frame, which is what distance looks
  // like — and with the soil's top edge being a single line, that lifted plant's base ended up
  // ABOVE the ground with a gap beneath it. It read as floating, which is worse than reading
  // as flat.
  //
  // So the surface is a BAND rather than an edge: a strip of receding ground reaching up to
  // where the furthest plot stands, darkening with distance. Every plant now has ground under
  // it whatever its depth, and the band is what makes the lift legible as distance rather than
  // as levitation.
  const far = soilTop + RECEDE_BAND;
  const back = ctx.createLinearGradient(0, far, 0, soilTop + 2);
  back.addColorStop(0, PALETTE.soilFar);
  back.addColorStop(1, PALETTE.soil);
  ctx.beginPath();
  ctx.moveTo(0, soilTop + 3);
  ctx.lineTo(0, far + 1.5 * Math.sin(0.041));
  for (let x = 1; x <= w; x++)
    ctx.lineTo(x, far + 1.5 * Math.sin(x * 0.041) + 0.8 * Math.sin(x * 0.11));
  ctx.lineTo(w, soilTop + 3);
  ctx.closePath();
  ctx.fillStyle = back;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, crest(0));
  for (let x = 1; x <= w; x++) ctx.lineTo(x, crest(x));
  ctx.lineTo(w, h);
  ctx.closePath();
  // A vertical gradient, not a flat fill. A thin band gets away with one colour; the deep
  // band the garden needs (to seat the seed tray on the dirt) read as a grey slab across the
  // bottom quarter of the frame — the same "this looks like a caption strip" failure the
  // irregular crest was introduced to fix, returning as soon as the band got tall. Falling
  // off toward the bottom reads as depth of earth instead of as a rectangle.
  const grad = ctx.createLinearGradient(0, soilTop, 0, h);
  grad.addColorStop(0, PALETTE.soil);
  grad.addColorStop(1, PALETTE.soilDeep);
  ctx.fillStyle = grad;
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

/** Ticks a flower takes to open once its shoot has finished. */
const OPEN_TICKS = 26;

/**
 * A pool of shadow where a stem meets the soil.
 *
 * Measured before this existed: the soil directly under a stem was 0.1 units darker than the
 * soil beside it — which is to say identical. Every plant was pasted onto the ground rather
 * than growing out of it, and no amount of work on the plant itself fixes that, because the
 * missing information is about the CONTACT rather than about the plant.
 *
 * Drawn as a soft radial pool rather than a cast shadow: the light is high and diffuse here,
 * there is no other cast shadow anywhere in the scene, and one plant throwing a hard shadow
 * while nothing else does would read as an error rather than as light.
 *
 * @param width Stem width at the base — a thick trunk sits in a wider pool than a seedling.
 */
export function paintContactShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
): void {
  const rx = Math.max(9, width * 2.6);
  const ry = Math.max(3, width * 0.85);
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function paintPlant(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  untilTick = Infinity,
): void {
  /**
   * How far open a flower is, from how long ago its shoot terminated.
   *
   * Flowers used to switch on at full size the instant their tick arrived, which read as a
   * plant acquiring decorations rather than coming into flower. `Infinity` — the default, and
   * what the background buffer composites with — gives 1, so a retired plant is never frozen
   * half-open.
   */
  const opening = (tick: number): number => {
    const age = untilTick - tick;
    return age >= OPEN_TICKS ? 1 : 0.32 + 0.68 * ease(Math.max(0, age) / OPEN_TICKS);
  };
  // Stems first, deepest chains behind. Each carries an ink contour: the art direction
  // applies to stems as well as petals, and previously only petals were outlined.
  const chains = groupChains(visibleSegments(plant, untilTick));
  chains.sort((a, b) => (b[0]?.depth ?? 0) - (a[0]?.depth ?? 0));
  for (const chain of chains) {
    const dense = smoothChain(chain, 3);
    const outline = buildOutline(dense);
    fillOutline(
      ctx,
      outline,
      plant.albino
        ? chain[0]!.depth === 0
          ? PALETTE.stemAlbinoHi
          : PALETTE.stemAlbino
        : chain[0]!.depth === 0
          ? PALETTE.stemHi
          : PALETTE.stem,
    );

    // Round the stem. Two strips inside the silhouette — a shadow band on the far side and a
    // narrower highlight on the lit side — turn a flat ribbon into a cylinder. At 4x
    // magnification the unshaded version read as a paper cut-out, which no amount of work on
    // the petals was going to fix: stems and leaves are most of the plant's area.
    // Nested strips at falling alpha rather than one band each. A single strip has a hard
    // polygon edge that reads as a stripe painted ON the stem — visible as a seam down every
    // thick trunk — where a stack of three approximates the smooth falloff of a curved
    // surface. A gradient would be better still, but a gradient cannot follow a curve.
    for (const [scale, toward, color] of [
      [0.74, -0.13, PALETTE.stemShade],
      [0.52, -0.24, PALETTE.stemShade],
      [0.42, 0.24, PALETTE.stemLit],
      [0.2, 0.34, PALETTE.stemLit],
    ] as const) {
      fillOutline(
        ctx,
        buildOutline(dense, { widthScale: scale, towardLight: toward }),
        color,
      );
    }

    if (outline.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(outline[0]!.x, outline[0]!.y);
      for (let i = 1; i < outline.length; i++)
        ctx.lineTo(outline[i]!.x, outline[i]!.y);
      ctx.closePath();
      ctx.strokeStyle = plant.albino ? PALETTE.stemAlbinoRim : PALETTE.stemRim;
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
    // A gradient across the blade, not a flat fill. The direction is the leaf's own normal
    // resolved against the shared LIGHT vector, so a leaf pointing down-right is lit on the
    // same real side as one pointing up-left — lighting each blade from its own local frame
    // is what makes procedural foliage read as a sheet of identical decals.
    const nx = -Math.sin(lf.angle);
    const ny = Math.cos(lf.angle);
    const facing = Math.sign(nx * LIGHT.x + ny * LIGHT.y) || 1;
    const half = lf.width * 0.6 * facing;
    const g = ctx.createLinearGradient(
      lf.attach.x + nx * half,
      lf.attach.y + ny * half,
      lf.attach.x - nx * half,
      lf.attach.y - ny * half,
    );
    g.addColorStop(0, plant.albino ? PALETTE.leafAlbinoLit : PALETTE.leafLit);
    g.addColorStop(1, plant.albino ? PALETTE.leafAlbino : PALETTE.leaf);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = plant.albino ? PALETTE.stemAlbinoRim : PALETTE.leafRim;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Veins only once the blade is big enough for them to be more than noise. Below ~9px a
    // vein is a single dark pixel row and just muddies the fill.
    ctx.strokeStyle = PALETTE.leafVein;
    const rib = leafMidrib(lf);
    ctx.beginPath();
    ctx.moveTo(rib[0]!.x, rib[0]!.y);
    for (let i = 1; i < rib.length; i++) ctx.lineTo(rib[i]!.x, rib[i]!.y);
    ctx.lineWidth = 0.8;
    ctx.stroke();

    if (lf.length > 9) {
      ctx.beginPath();
      for (const [a, b] of leafVeins(lf)) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.lineWidth = 0.55;
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

  // Occluded blooms are DROPPED, not drawn. A bloom whose centre sits inside a kept
  // bloom's disc contributes no readable flower — but it did contribute a centre dot, and
  // those fused into chains: one panel collapsed ~85 centres into 29 blobs, the largest a
  // 20-deep "string of beads" draped across the canopy. Culling also opens the canopy so
  // branch geometry behind it becomes visible.
  // Also gated by tick, so flowers appear as their shoots finish rather than all at once.
  // Culling uses each bloom's FULL radius, not its opening one, so the set of flowers on
  // screen is decided once and does not flicker as they open.
  const blooms = cullOccludedBlooms(
    plant.blooms.filter((b) => b.tick <= untilTick),
  );

  // Glow radius and alpha cut hard. At 1.7x radius the halo measured an 18-27px ramp whose
  // pixel area equalled up to 100% of the drawn plant, roughly 20:1 against the 1px rim —
  // so the eye read bloom-haze instead of linework, and every contour fix drowned in it.
  for (const b of blooms) {
    const r = b.radius * 1.15 * opening(b.tick);
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

  // Per-bloom transform, shared by the petal and centre passes.
  const withBloomTransform = (
    b: (typeof plant.blooms)[number],
    draw: () => void,
  ): void => {
    ctx.save();
    // Nodding foreshortening: a bloom on a downward-pointing shoot is seen obliquely, so
    // squash it across the shoot axis. Without this every bloom faced the viewer dead-on
    // and a weeping plant's flowers read as merely positioned low, not as pendant.
    const squash = 1 - 0.45 * b.tilt;
    const o = opening(b.tick);
    ctx.translate(b.center.x, b.center.y);
    ctx.scale(o, o * squash);
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
        //
        // `paintPetal` adds what the flat fill could not: light through the thin tip, shadow
        // where petals stack, and a midrib. Affordable because a settled plant is rendered
        // once into a cached bitmap rather than every frame.
        paintPetal(
          ctx,
          p,
          petalPath(p),
          petalFill(ctx, p, b.hueClass, b.white),
          // Hue class matters now that lightness varies per hue: the rim is chosen by
          // CONTRAST with the fill, so passing the wrong lightness picks the wrong rim.
          petalRim(b.white, p.colorDepth, b.hueClass),
          petalRimWidth(p.width),
          b.hueClass,
          b.white,
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
