import type { Phenotype } from "../types";
import { dosage, type Genome } from "./genome";
import {
  D_ALLELES,
  MAX_DOSAGE,
  P_ALLELES,
  PETAL_SHAPE_OF,
  W_ALLELES,
  dominant,
} from "./loci";

/**
 * Combined dosage at the two hue loci: 0..4, one class per step.
 *
 * Discrete on purpose (§5). A continuous hue would smear segregation into near-misses that
 * nobody can see, which defeats the point of a Mendelian layer.
 */
export function hueDosage(g: Genome): 0 | 1 | 2 | 3 | 4 {
  const n =
    (g.H1[0] === "H1" ? 1 : 0) +
    (g.H1[1] === "H1" ? 1 : 0) +
    (g.H2[0] === "H2" ? 1 : 0) +
    (g.H2[1] === "H2" ? 1 : 0);
  return n as 0 | 1 | 2 | 3 | 4;
}

/** `W_` blocks anthocyanin: the flower reads white whatever the hue loci carry. */
export function isWhite(g: Genome): boolean {
  return dominant(W_ALLELES, g.W) === "W";
}

/** `dd` — the recessive that converts stamens to petals. */
export function isDoubled(g: Genome): boolean {
  return dominant(D_ALLELES, g.D) === "d";
}

/** 0..1 from a polygenic block's 0..12 dosage. */
function scale(block: { a: number; b: number }): number {
  return dosage(block) / MAX_DOSAGE;
}

/**
 * Genome → the flat parameter struct the growth engine consumes.
 *
 * Only eight loci are genetic (§5). The remaining phenotype fields are DERIVED from them
 * rather than given loci of their own, and each derivation is a real botanical coupling
 * rather than a filler constant: a weeping habit comes with a slack stem and a weaker pull
 * toward the light; a vigorous plant is thicker at the base and tapers more slowly; a bushy
 * plant carries more, smaller flowers on narrower side shoots. Coupling them keeps the gene
 * set legible — twelve independent sliders would make every plant a different kind of mush.
 *
 * Pure: no RNG, no plot index, no time. `express(g)` is the same phenotype forever, which is
 * what lets a shared genome reproduce the same plant for everybody (§6).
 */
export function express(g: Genome): Phenotype {
  const v = scale(g.V);
  const droopDose = scale(g.G);
  const b = scale(g.B);

  return {
    vigour: 0.35 + 0.6 * v,
    droop: 0.08 + 0.9 * droopDose,
    phototropism: 0.7 - 0.28 * droopDose,
    stiffness: 0.55 - 0.3 * droopDose,
    branchiness: 0.2 + 0.75 * b,
    baseWidth: 6.5 + 5.5 * v,
    taper: 0.973 + 0.008 * v,
    branchAngle: 0.36 + 0.38 * b,
    branchWidthRatio: 0.76 - 0.13 * b,
    doubled: isDoubled(g),
    petalShape: PETAL_SHAPE_OF[dominant(P_ALLELES, g.P)],
    hueClass: hueDosage(g),
    white: isWhite(g),
    bloomRadius: 14 + 9 * (1 - b) + 4 * v,
  };
}
