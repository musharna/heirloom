import type { PetalShape } from "../types";

/**
 * The eight loci of design §5.
 *
 * Allele arrays are ordered MOST DOMINANT FIRST, and that order is also the serialization
 * code (index 0 packs as 0). Both facts are load-bearing: `dominant()` picks the lowest
 * index present, and `serialize.ts` packs the index. Reordering an array silently changes
 * both the genetics and the wire format, so the round-trip test pins a fixed vector.
 */
export const W_ALLELES = ["W", "w"] as const;
export const H1_ALLELES = ["H1", "h1"] as const;
export const H2_ALLELES = ["H2", "h2"] as const;
export const D_ALLELES = ["D", "d"] as const;
/** Allele series: frilled > lobed > pointed > round. */
export const P_ALLELES = ["P^f", "P^l", "P^p", "p"] as const;

export type WAllele = (typeof W_ALLELES)[number];
export type H1Allele = (typeof H1_ALLELES)[number];
export type H2Allele = (typeof H2_ALLELES)[number];
export type DAllele = (typeof D_ALLELES)[number];
export type PAllele = (typeof P_ALLELES)[number];

export const PETAL_SHAPE_OF: Record<PAllele, PetalShape> = {
  "P^f": "frilled",
  "P^l": "lobed",
  "P^p": "pointed",
  p: "round",
};

/**
 * Independent additive loci per polygenic block. Six per block, two homologs, so a block's
 * dosage runs 0..12 — fine enough to read as continuous drift, coarse enough that a single
 * mutation is a visible nudge rather than noise.
 */
export const POLY_LOCI = 6;
export const MAX_DOSAGE = POLY_LOCI * 2;

/**
 * The dominant allele of a pair: whichever appears earliest in the series.
 *
 * This is one function for all four discrete loci rather than four bespoke rules. `W`
 * dominant, `d` recessive and the `P` series are all the same operation once the arrays are
 * ordered — writing them separately is three more places for the order to drift.
 */
export function dominant<A extends string>(
  series: readonly A[],
  pair: readonly [A, A],
): A {
  const [x, y] = pair;
  return series.indexOf(x) <= series.indexOf(y) ? x : y;
}

/** Number of set bits in the low 32. */
export function popcount(n: number): number {
  let v = n >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
