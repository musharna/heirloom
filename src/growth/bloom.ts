import { angleDelta } from "../rng";
import type { Bloom, Phenotype, PetalSpec, Vec2 } from "../types";

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees

/**
 * @param openness 0..1 — how far this flower has opened, and how large it is relative to the
 *   phenotype's full bloom size. Every bloom being 1.0 made a flower head read as a sheet of
 *   identical stickers: no buds, no half-open flowers, no scale falloff toward the tips. Below
 *   ~0.55 the flower is treated as a BUD — a tight cone of few petals rather than a small
 *   open face, which is what a real unopened flower looks like.
 */
export function layoutBloom(
  pheno: Phenotype,
  center: Vec2,
  faceAngle: number,
  rand: () => number,
  openness = 1,
  tick = 0,
): Bloom {
  const bud = openness < 0.55;
  const radius = pheno.bloomRadius * (0.42 + 0.58 * openness);
  const whorls = bud ? 1 : pheno.doubled ? 3 : 1;
  // Merosity comes from the `N` series. Doubling adds a FIXED four rather than multiplying,
  // which keeps the tuned five-petal case at exactly the nine it was hand-set to while
  // stopping a twelve-petal double from reaching sixty petals in a bloom the size of a coin.
  const perWhorl = bud
    ? 3
    : pheno.doubled
      ? pheno.petalCount + 4
      : pheno.petalCount;
  const petals: PetalSpec[] = [];

  // Petals are spaced EVENLY within a whorl (2*PI / perWhorl), and successive whorls are
  // offset from each other by the golden angle so they interleave rather than stack.
  //
  // Applying the golden angle *within* a 5-petal whorl was a model error: 137.5deg only
  // distributes evenly in the limit of many petals, so on five it leaves uneven gaps and
  // the bloom reads as a pointed star instead of a flower. Even spacing is what real
  // single flowers do; the golden angle belongs between whorls, not inside one.
  const spacing = (Math.PI * 2) / perWhorl;
  // Petal width is set as a fraction of LENGTH so the silhouette stays longer-than-wide.
  //
  // A previous attempt required neighbouring petals to touch with no gap. On a 5-petal
  // whorl that is geometrically impossible without width exceeding length, and it forced
  // an aspect ratio of 1.05 — a square. Real 5-petal flowers (buttercup, wild rose,
  // phlox) DO show gaps between petal tips; what makes them read as flowers is a broad
  // obovate margin and a visible centre, not gapless coverage.
  //
  // With merosity now genetic, a constant factor stops working: 0.66 on a twelve-petal whorl
  // is 36 degrees of petal in a 30-degree slot, and the flower fuses into a plain disc. What
  // has to stay constant is the FILL — the fraction of its angular slot a petal occupies —
  // and the width that achieves it follows from the slot's half-angle.
  //
  // The two fill constants are not new numbers: they are the values that reproduce the
  // hand-tuned 0.66 at five petals and 0.42 at nine. A generalisation that moved the numbers
  // it was generalising from would be a regression wearing a refactor's clothes (§20).
  const fill = pheno.doubled ? 0.58 : 0.51;
  const widthFactor = 2 * Math.tan((fill * Math.PI) / perWhorl);

  for (let w = 0; w < whorls; w++) {
    const whorlScale = 1 - 0.22 * w;
    const colorDepth = whorls === 1 ? 0 : w / (whorls - 1);
    for (let k = 0; k < perWhorl; k++) {
      petals.push({
        center: { ...center },
        angle: faceAngle + w * GOLDEN + k * spacing,
        // A bud's petals are short and clasped inward rather than spread.
        length: radius * whorlScale * (0.9 + 0.2 * rand()) * (bud ? 0.72 : 1),
        width: radius * widthFactor * whorlScale * (bud ? 0.8 : 1),
        shape: pheno.petalShape,
        colorDepth,
      });
    }
  }

  // Calyx: sepals sit BEHIND the corolla, offset by half a petal step so each one shows
  // through the gap between two petals. Every flower has one, and it is what turns five
  // separated petals into a layered bloom instead of a five-bladed pinwheel with raw
  // background showing between the blades.
  const sepals: PetalSpec[] = [];
  const sepalCount = 5;
  const sepalSpacing = (Math.PI * 2) / sepalCount;
  for (let k = 0; k < sepalCount; k++) {
    sepals.push({
      center: { ...center },
      angle: faceAngle + sepalSpacing / 2 + k * sepalSpacing,
      length: radius * 0.82,
      width: radius * 0.5,
      shape: "pointed",
      colorDepth: 0,
    });
  }

  // How far the shoot has turned away from straight up, normalised. A bloom on a
  // downward-pointing shoot is seen obliquely, so the renderer foreshortens it.
  const tilt = Math.min(
    1,
    Math.abs(angleDelta(faceAngle, -Math.PI / 2)) / Math.PI,
  );

  return {
    center: { ...center },
    radius,
    petals,
    sepals,
    hueClass: pheno.hueClass,
    white: pheno.white,
    // A bud shows no stamen boss — it has not opened.
    stamens: !pheno.doubled && !bud,
    tilt,
    tick,
  };
}
