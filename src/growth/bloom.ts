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

  let i = 0;
  for (let w = 0; w < whorls; w++) {
    const whorlScale = 1 - 0.22 * w;
    const colorDepth = whorls === 1 ? 0 : w / (whorls - 1);
    for (let k = 0; k < perWhorl; k++) {
      petals.push({
        center: { ...center },
        angle: faceAngle + i * GOLDEN,
        length: pheno.bloomRadius * whorlScale * (0.9 + 0.2 * rand()),
        width: pheno.bloomRadius * 0.55 * whorlScale,
        shape: pheno.petalShape,
        colorDepth,
      });
      i++;
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
