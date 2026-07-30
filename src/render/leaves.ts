import type { LeafSpec, Vec2 } from "../types";

/**
 * Per-leaf shape, derived from the spec's seed.
 *
 * Length, width and angle alone left every blade the same outline at a different size — which
 * at magnification reads as one stamp repeated, not as foliage. These four numbers are what
 * make two leaves on the same plant actually different plants' worth of different.
 */
function traits(spec: LeafSpec): {
  fat: number;
  teeth: number;
  toothDepth: number;
  curl: number;
} {
  const s = spec.seed;
  return {
    // Exponent on the blade's leading edge: low is broad and rounded, high is narrow.
    fat: 0.4 + 0.24 * s,
    // Serration count. Non-integer on purpose — an integer count makes every blade's margin
    // land in phase with every other, restoring the stamped look this is meant to break.
    teeth: 7 + 5.3 * s,
    toothDepth: 0.06 + 0.09 * (1 - s),
    // Lateral bow of the midline, away from the shoot the leaf grew on.
    curl: (0.1 + 0.22 * s) * spec.side,
  };
}

/** Lateral offset of the midline at t, as a fraction of leaf width. */
function bow(t: number, curl: number): number {
  return curl * Math.sin(Math.PI * t);
}

/**
 * Ovate blade with a drawn-out tip, a serrate margin and a curved midline. Sampled densely
 * enough that the serrations are curves rather than axis-aligned stair-steps — undersampling
 * a periodic margin is what made the lobed petal read as a jigsaw piece.
 */
export function leafPath(spec: LeafSpec, samples = 64): Vec2[] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const place = (along: number, across: number): Vec2 => ({
    x: spec.attach.x + along * cos - across * sin,
    y: spec.attach.y + along * sin + across * cos,
  });
  const { fat, teeth, toothDepth, curl } = traits(spec);

  // A short petiole, then the blade.
  const PET = 0.18;
  const upper: Vec2[] = [];
  const lower: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mid = bow(t, curl) * spec.width;
    let hw: number;
    if (t < PET) {
      hw = 0.055; // petiole stays thin
    } else {
      const u = (t - PET) / (1 - PET);
      // Ovate: widest partway along, tapering to a point.
      const blade =
        Math.pow(u, fat) * Math.pow(Math.max(0, 1 - u), 0.85) * 2.05;
      // Serrations fade out at both ends so the base and tip stay clean.
      const teethMod =
        1 + toothDepth * Math.sin(teeth * Math.PI * u) * Math.sin(Math.PI * u);
      hw = blade * teethMod;
    }
    upper.push(place(t * spec.length, mid + (hw * spec.width) / 2));
    lower.push(place(t * spec.length, mid - (hw * spec.width) / 2));
  }
  return upper.concat(lower.reverse());
}

/**
 * Midrib, following the blade's curved midline rather than a straight chord.
 *
 * Returns a polyline. A straight two-point rib on a curved blade visibly leaves the leaf near
 * the tip, which reads as a crack across the surface rather than as a vein.
 */
export function leafMidrib(spec: LeafSpec, samples = 16): Vec2[] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const { curl } = traits(spec);
  const out: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * 0.9;
    const across = bow(t, curl) * spec.width;
    out.push({
      x: spec.attach.x + t * spec.length * cos - across * sin,
      y: spec.attach.y + t * spec.length * sin + across * cos,
    });
  }
  return out;
}

/**
 * Secondary veins, as pairs running from the midrib toward the margin.
 *
 * Angled forward toward the tip, the way real pinnate venation runs. Perpendicular veins look
 * like a ladder, which is worse than no veins at all.
 */
export function leafVeins(spec: LeafSpec): [Vec2, Vec2][] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const { fat, curl } = traits(spec);
  const place = (along: number, across: number): Vec2 => ({
    x: spec.attach.x + along * cos - across * sin,
    y: spec.attach.y + along * sin + across * cos,
  });

  const PET = 0.18;
  /** Blade half-width at t, as a fraction of spec.width. Matches leafPath's profile. */
  const halfAt = (t: number): number => {
    if (t < PET) return 0.055 / 2;
    const u = (t - PET) / (1 - PET);
    return (Math.pow(u, fat) * Math.pow(Math.max(0, 1 - u), 0.85) * 2.05) / 2;
  };

  const out: [Vec2, Vec2][] = [];
  const pairs = 4;
  for (let i = 1; i <= pairs; i++) {
    const t = PET + ((i - 0.4) / (pairs + 0.6)) * (1 - PET);
    const from = place(t * spec.length, bow(t, curl) * spec.width);
    // Reach forward toward the tip, stopping short of the margin — a vein that touched the
    // edge would read as the blade being split into segments.
    const tipT = t + (1 - t) * 0.34;
    // Width measured AT THE ENDPOINT, not at the origin. Measuring at the origin overshoots,
    // because the blade is narrower where the vein lands than where it starts, and the vein
    // tips punched through the outline.
    const reach = halfAt(tipT) * spec.width * 0.72;
    const midTip = bow(tipT, curl) * spec.width;
    for (const s of [1, -1]) {
      out.push([from, place(tipT * spec.length, midTip + s * reach)]);
    }
  }
  return out;
}
