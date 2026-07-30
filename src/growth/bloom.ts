import type { Bloom, Phenotype, PetalSpec, Vec2 } from "../types";

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees

export function layoutBloom(
  pheno: Phenotype,
  center: Vec2,
  faceAngle: number,
  rand: () => number,
): Bloom {
  const whorls = pheno.doubled ? 3 : 1;
  const perWhorl = pheno.doubled ? 9 : 5;
  const petals: PetalSpec[] = [];

  // Petals are spaced EVENLY within a whorl (2*PI / perWhorl), and successive whorls are
  // offset from each other by the golden angle so they interleave rather than stack.
  //
  // Applying the golden angle *within* a 5-petal whorl was a model error: 137.5deg only
  // distributes evenly in the limit of many petals, so on five it leaves uneven gaps and
  // the bloom reads as a pointed star instead of a flower. Even spacing is what real
  // single flowers do; the golden angle belongs between whorls, not inside one.
  const spacing = (Math.PI * 2) / perWhorl;
  // Petals must be broad enough that neighbours touch, or the gaps read as star points.
  const widthFactor = pheno.doubled ? 0.62 : 0.95;

  for (let w = 0; w < whorls; w++) {
    const whorlScale = 1 - 0.22 * w;
    const colorDepth = whorls === 1 ? 0 : w / (whorls - 1);
    for (let k = 0; k < perWhorl; k++) {
      petals.push({
        center: { ...center },
        angle: faceAngle + w * GOLDEN + k * spacing,
        length: pheno.bloomRadius * whorlScale * (0.9 + 0.2 * rand()),
        width: pheno.bloomRadius * widthFactor * whorlScale,
        shape: pheno.petalShape,
        colorDepth,
      });
    }
  }

  return {
    center: { ...center },
    radius: pheno.bloomRadius,
    petals,
    hueClass: pheno.hueClass,
    white: pheno.white,
    stamens: !pheno.doubled,
  };
}
