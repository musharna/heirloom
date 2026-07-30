import type { PetalShape, PetalSpec, Vec2 } from "../types";

/**
 * Obovate half-width profile: a narrow attachment at the base, broadest around two
 * thirds along, then a convex margin rounding off to the apex.
 *
 * This replaces a profile that reached 53% of full width by t=0.10 and then plateaued
 * near 96% from t=0.3 to t=0.5. That gave straight parallel sides and a blunt outer
 * corner which, combined with a width equal to the petal's length (measured aspect
 * 1.05), rendered each petal as a rounded SQUARE — so five of them read as a paper
 * pinwheel instead of a flower.
 */
function obovate(t: number): number {
  return Math.pow(t, 0.85) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 3.2)));
}

/** Raw, un-normalised margin profile per shape allele. */
function rawProfile(shape: PetalShape, t: number): number {
  const b = obovate(t);
  switch (shape) {
    case "round":
      return b;
    case "pointed":
      // Lanceolate: shoulders pulled in, apex drawn to a genuine point.
      return Math.pow(t, 0.7) * Math.pow(Math.max(0, 1 - t), 0.75);
    // Both periodic margins fade their amplitude to zero at the base and the apex, via the
    // sin(PI*t) envelope. Without it the oscillation ran right into the attachment and
    // pinched the petal away from the receptacle, so a lobed bloom read as five
    // disconnected lumps in a ring. Frequencies are also low enough to stay resolvable at
    // the sample count used by petalPath — undersampling a periodic margin is what turned
    // these outlines into axis-aligned stair-steps.
    // Amplitudes are LARGE on purpose. At 0.26/0.20 these two alleles changed total petal
    // area by 0.5% and 2.3% against baseline and were invisible at the size the game
    // actually renders — measured, not guessed. A gene the player cannot see is not a gene.
    // Amplitude is a balance: too small and the allele is invisible at render scale (0.26
    // changed petal area by 0.5%), too large and the margin turns into angular V-notch
    // cusps instead of rounded scallops (0.62 did exactly that). These sit between, with
    // LOW frequencies so each undulation is broad enough to read as a shape rather than
    // as sawtooth aliasing.
    case "lobed":
      // Two deep rounded scallops per margin.
      return b * (1 + 0.44 * Math.cos(4 * Math.PI * t) * Math.sin(Math.PI * t));
    case "frilled":
      // A faster, shallower ripple — a different rhythm from lobed, not a milder one.
      return b * (1 + 0.28 * Math.sin(9 * Math.PI * t) * Math.sin(Math.PI * t));
  }
}

const SHAPES: PetalShape[] = ["round", "pointed", "lobed", "frilled"];

/** Peak of each raw profile, so every shape normalises to a half-width of 1. */
const PEAK: Record<PetalShape, number> = (() => {
  const out = {} as Record<PetalShape, number>;
  for (const s of SHAPES) {
    let m = 0;
    for (let i = 0; i <= 200; i++) m = Math.max(m, rawProfile(s, i / 200));
    out[s] = m || 1;
  }
  return out;
})();

function halfWidth(shape: PetalShape, t: number): number {
  return rawProfile(shape, t) / PEAK[shape];
}

/**
 * Per-shape width multiplier. Silhouette *proportion* is part of what makes the P locus
 * legible at panel scale: a pointed petal is narrow, a lobed one is broad.
 */
const SHAPE_WIDTH: Record<PetalShape, number> = {
  round: 1.0,
  pointed: 0.6,
  // Lobed and frilled were 1.12 / 1.04 — near-identical proportions, so the two alleles
  // differed only in margin rhythm and measured within 5.6% of each other in area. Broad
  // scalloped versus narrow ruffled separates them by silhouette, not just by texture.
  // Widening lobed past ~1.2 drops its aspect below the anti-square floor of 1.25, which
  // is the constraint that prevents the pinwheel regression — so the separation between
  // these two alleles is carried mostly by narrowing frilled instead.
  lobed: 1.18,
  frilled: 0.85,
};

/** Symmetric petal outline, rotated by spec.angle and translated to spec.center. */
export function petalPath(spec: PetalSpec, samples = 96): Vec2[] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const w = spec.width * SHAPE_WIDTH[spec.shape];
  const place = (along: number, across: number): Vec2 => ({
    x: spec.center.x + along * cos - across * sin,
    y: spec.center.y + along * sin + across * cos,
  });

  const upper: Vec2[] = [];
  const lower: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const hw = (halfWidth(spec.shape, t) * w) / 2;
    upper.push(place(t * spec.length, hw));
    lower.push(place(t * spec.length, -hw));
  }
  return upper.concat(lower.reverse());
}

/** Length-to-width ratio of a shape's rendered silhouette. Guards the square regression. */
export function petalAspect(spec: PetalSpec): number {
  return spec.length / (spec.width * SHAPE_WIDTH[spec.shape]);
}

const HUES = [350, 20, 320, 285, 250]; // crimson, coral, magenta, violet, blue

export function petalColor(
  hueClass: number,
  white: boolean,
  colorDepth: number,
): string {
  // Value ramp runs LIGHTER toward the centre, not darker. Darkening inward turned a
  // doubled bloom's packed inner whorl into a near-black crater — darker than the ground
  // it sat on. Real doubled flowers catch light in the furl, so the ordering is inverted.
  if (white) return `hsl(45 14% ${88 + 7 * colorDepth}%)`;
  const h = HUES[hueClass] ?? HUES[0]!;
  return `hsl(${h} ${72 - 6 * colorDepth}% ${56 + 13 * colorDepth}%)`;
}

/** HSL lightness percentage of the fill a petal will be painted with. */
export function petalLightness(white: boolean, colorDepth: number): number {
  return white ? 88 + 7 * colorDepth : 56 + 13 * colorDepth;
}

/**
 * Rim colour chosen RELATIVE to the fill it outlines, rather than a fixed light value.
 *
 * A fixed pale rim cannot draw a pale flower: on the white morph the fill is ~(229,227,220)
 * and a light rim had no contrast to give, so the petals fused into a smear. Contrast, not
 * lightness, is what makes an outline an outline — so a light fill gets a dark rim and a
 * mid/dark fill gets a light one.
 */
export function petalRim(white: boolean, colorDepth: number): string {
  return petalLightness(white, colorDepth) > 76
    ? "rgba(64,52,44,0.7)"
    : "rgba(255,236,228,0.85)";
}

/**
 * Translucent glow matching the bloom's own hue. A hardcoded glow colour put a pink halo
 * around blue and magenta flowers, which read as a lighting bug rather than as bloom.
 */
export function petalGlow(
  hueClass: number,
  white: boolean,
  alpha: number,
): string {
  if (white) return `hsl(45 28% 93% / ${alpha})`;
  const h = HUES[hueClass] ?? HUES[0]!;
  return `hsl(${h} 85% 66% / ${alpha})`;
}

/** Thin canvas wrapper. No logic worth testing. */
export function fillPetal(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  fill: string,
  stroke: string,
): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // The petal edge IS the line-art of the art direction, so it has to actually read.
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}
