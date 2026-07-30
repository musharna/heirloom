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
    case "lobed":
      // Three large rounded scallops per margin. Silhouette-level, not a 1px notch.
      return b * (1 + 0.3 * Math.cos(6 * Math.PI * t));
    case "frilled":
      // Ruffled margin: more undulations, still large enough to read at panel scale.
      return b * (1 + 0.22 * Math.sin(11 * Math.PI * t));
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
  lobed: 1.12,
  frilled: 1.04,
};

/** Symmetric petal outline, rotated by spec.angle and translated to spec.center. */
export function petalPath(spec: PetalSpec, samples = 40): Vec2[] {
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
  if (white) return `hsl(45 14% ${94 - 10 * colorDepth}%)`;
  const h = HUES[hueClass] ?? HUES[0]!;
  // Lightness floor keeps a doubled bloom's inner whorls from collapsing to a black hole.
  return `hsl(${h} ${72 - 8 * colorDepth}% ${64 - 16 * colorDepth}%)`;
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
