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
  // 0.6 was too narrow to read as a petal. At 4x magnification a five-petal `pointed` whorl
  // rendered as an asterisk — five spikes radiating from a dot — because a lanceolate profile
  // already tapers at both ends and the width multiplier narrowed it again on top. 0.76 keeps
  // it clearly the narrow allele against round's 1.0 while leaving enough blade to be a petal.
  pointed: 0.76,
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

/**
 * Per-hue tone, not one saturation for all five.
 *
 * Equal HSL saturation does NOT give equal perceived intensity. At S=72 the blue and violet
 * classes read electric — like UI accent colours — while the same number on coral reads as a
 * flower, because the eye is far more tolerant of saturation in warm hues than in the
 * blue-violet range. Holding S and L constant across the hue wheel was the whole of defect §13.5.
 *
 * So each class carries its own saturation and lightness, pulled hardest where the hue is
 * least forgiving. The art direction asks for muted-saturated; that is a per-hue judgement,
 * not a global constant.
 */
const HUE_TONE: { h: number; s: number; l: number }[] = [
  { h: 349, s: 58, l: 57 }, // crimson
  { h: 18, s: 63, l: 60 }, // coral
  { h: 322, s: 48, l: 60 }, // magenta
  { h: 288, s: 34, l: 62 }, // violet — pulled hard
  { h: 238, s: 30, l: 62 }, // blue — pulled hardest, and warmed off pure 250
];

export function petalColor(
  hueClass: number,
  white: boolean,
  colorDepth: number,
): string {
  // Value ramp runs LIGHTER toward the centre, not darker. Darkening inward turned a
  // doubled bloom's packed inner whorl into a near-black crater — darker than the ground
  // it sat on. Real doubled flowers catch light in the furl, so the ordering is inverted.
  if (white) return `hsl(45 14% ${88 + 7 * colorDepth}%)`;
  const t = HUE_TONE[hueClass] ?? HUE_TONE[0]!;
  return `hsl(${t.h} ${t.s - 5 * colorDepth}% ${t.l + 12 * colorDepth}%)`;
}

/**
 * HSL lightness percentage of the fill a petal will be painted with.
 *
 * Takes the hue class now that lightness varies per hue — a duplicated constant here would
 * drift from `petalColor` the first time either was tuned, and this value decides which rim a
 * petal gets, so drift would show up as an unreadable outline rather than as a wrong number.
 */
export function petalLightness(
  white: boolean,
  colorDepth: number,
  hueClass = 0,
): number {
  if (white) return 88 + 7 * colorDepth;
  return (HUE_TONE[hueClass] ?? HUE_TONE[0]!).l + 12 * colorDepth;
}

/**
 * Rim colour chosen RELATIVE to the fill it outlines, rather than a fixed light value.
 *
 * A fixed pale rim cannot draw a pale flower: on the white morph the fill is ~(229,227,220)
 * and a light rim had no contrast to give, so the petals fused into a smear. Contrast, not
 * lightness, is what makes an outline an outline — so a light fill gets a dark rim and a
 * mid/dark fill gets a light one.
 */
const RIM_DARK = "rgba(64,52,44,0.7)";
const RIM_LIGHT = "rgba(255,236,228,0.85)";
/** Approximate luminance of each rim, 0..255, for comparing against a fill. */
const RIM_DARK_L = (64 + 52 + 44) / 3;
const RIM_LIGHT_L = (255 + 236 + 228) / 3;

export function petalRim(
  white: boolean,
  colorDepth: number,
  hueClass = 0,
): string {
  // Pick whichever rim has MORE contrast, rather than flipping at a fixed lightness.
  //
  // The threshold version said "lighter than 76 gets a dark rim", which worked only while
  // every hue shared one lightness. Once violet and blue moved lighter, their innermost
  // whorls landed at 74 — just under the line — and kept a light rim with 51 units of
  // contrast, well below the 55 the rule requires. Those petals would have fused into
  // exactly the smear this function exists to prevent.
  //
  // Comparing both candidates has no threshold to tune and cannot be knocked out of range by
  // a later colour change: the docstring's own claim is that CONTRAST decides, so measure it.
  const fillL = (petalLightness(white, colorDepth, hueClass) / 100) * 255;
  return Math.abs(RIM_DARK_L - fillL) > Math.abs(RIM_LIGHT_L - fillL)
    ? RIM_DARK
    : RIM_LIGHT;
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
  const t = HUE_TONE[hueClass] ?? HUE_TONE[0]!;
  // A little hotter than the fill, so a glow reads as light rather than as a second petal.
  return `hsl(${t.h} ${Math.min(96, t.s + 22)}% ${t.l + 8}% / ${alpha})`;
}

/**
 * Along-petal gradient: deeper toward the throat, lighter toward the margin.
 *
 * Flat single-value fills were what made blooms read as vector clip-art rather than as
 * petals — a scanline straight across a petal returned one byte-identical colour the whole
 * way. Shading runs along the petal AXIS (base to tip), which is the direction light and
 * pigment actually vary in.
 */
export function petalFill(
  ctx: CanvasRenderingContext2D,
  spec: PetalSpec,
  hueClass: number,
  white: boolean,
): CanvasGradient {
  const tipX = spec.center.x + Math.cos(spec.angle) * spec.length;
  const tipY = spec.center.y + Math.sin(spec.angle) * spec.length;
  const g = ctx.createLinearGradient(spec.center.x, spec.center.y, tipX, tipY);
  const d = spec.colorDepth;
  g.addColorStop(0, petalColor(hueClass, white, Math.max(0, d - 0.4)));
  g.addColorStop(1, petalColor(hueClass, white, Math.min(1, d + 0.4)));
  return g;
}

/** Thin canvas wrapper. No logic worth testing. */
/**
 * Rim weight for a petal of a given width.
 *
 * A FIXED 1px rim is only correct at one petal size. On a doubled bloom's inner whorl a petal
 * is ~3px wide, so a 1px outline drawn down both margins claimed most of its area and those
 * flowers rendered as white filigree with a trace of colour — measured at 4x magnification,
 * where a small magenta double was almost entirely rim. Scaling with the petal keeps the
 * line-art reading at every size, and the floor keeps it from vanishing on the smallest.
 */
export function petalRimWidth(petalWidth: number): number {
  return Math.max(0.35, Math.min(1.1, petalWidth * 0.11));
}

export function fillPetal(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  fill: string | CanvasGradient,
  stroke: string,
  rimWidth = 1,
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
  ctx.lineWidth = rimWidth;
  ctx.stroke();
}
