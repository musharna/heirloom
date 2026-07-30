import type { LeafSpec, Vec2 } from "../types";

/**
 * Ovate blade with a drawn-out tip and a serrate margin. Sampled densely enough that the
 * serrations are curves rather than axis-aligned stair-steps — undersampling a periodic
 * margin is what made the lobed petal read as a jigsaw piece.
 */
export function leafPath(spec: LeafSpec, samples = 64): Vec2[] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const place = (along: number, across: number): Vec2 => ({
    x: spec.attach.x + along * cos - across * sin,
    y: spec.attach.y + along * sin + across * cos,
  });

  // A short petiole, then the blade.
  const PET = 0.18;
  const upper: Vec2[] = [];
  const lower: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    let hw: number;
    if (t < PET) {
      hw = 0.055; // petiole stays thin
    } else {
      const u = (t - PET) / (1 - PET);
      // Ovate: widest about a third along, tapering to a point.
      const blade =
        Math.pow(u, 0.5) * Math.pow(Math.max(0, 1 - u), 0.85) * 2.05;
      // Serrations fade out at both ends so the base and tip stay clean.
      const teeth = 1 + 0.1 * Math.sin(9 * Math.PI * u) * Math.sin(Math.PI * u);
      hw = blade * teeth;
    }
    upper.push(place(t * spec.length, (hw * spec.width) / 2));
    lower.push(place(t * spec.length, (-hw * spec.width) / 2));
  }
  return upper.concat(lower.reverse());
}

/** Midrib, drawn as a line from the attachment to the leaf tip. */
export function leafMidrib(spec: LeafSpec): [Vec2, Vec2] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  return [
    { x: spec.attach.x, y: spec.attach.y },
    {
      x: spec.attach.x + spec.length * 0.88 * cos,
      y: spec.attach.y + spec.length * 0.88 * sin,
    },
  ];
}
