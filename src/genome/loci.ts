import type { Inflorescence, PetalShape } from "../types";

/**
 * The discrete loci of design §5, extended in §21.
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

/**
 * Inflorescence architecture — WHERE flowers sit on the plant, not what they look like.
 *
 * This is the trait the original had no concept of, and the reason two plants of the same
 * colour could never be told apart at a glance: every plant was a solitary flower per shoot
 * tip. Arrangement is what a botanist reads first, and it survives being shrunk to a
 * thumbnail in the background forest, which colour and petal shape do not.
 *
 * Series: umbel > raceme > spike > solitary. Solitary is the recessive baseline, so an
 * unimproved founder population still looks like the original game.
 */
export const I_ALLELES = ["I^u", "I^r", "I^s", "i"] as const;

/**
 * Petal number, as a genuine allele series rather than a polygenic dial.
 *
 * Merosity in real flowers is discrete and heritable — a five-petalled and an eight-petalled
 * form of the same species segregate cleanly — and a discrete series is also the only version
 * a player can actually count. A polygenic petal count would land on 6.4 and read as noise.
 *
 * Series: 12 > 8 > 6 > 5. High counts dominant so a fuller flower shows in F1.
 */
export const N_ALLELES = ["N^12", "N^8", "N^6", "n"] as const;
export const PETAL_COUNT_OF: Record<NAllele, number> = {
  "N^12": 12,
  "N^8": 8,
  "N^6": 6,
  n: 5,
};

/**
 * The chlorophyll locus. `ll` seedlings are albino: they germinate, exhaust the seed's
 * reserves, and die without ever blooming.
 *
 * This is the textbook recessive lethal, and it is here for one reason — it is the only way
 * to make CARRIERS matter. Every other locus in this game shows what it is. `Ll` looks
 * exactly like `LL`, so the only evidence a plant carries albinism is that a quarter of its
 * self-progeny come up white and die, which is precisely the inference Mendel had to make.
 *
 * It is deliberately gentle: the seedling is visible on the bed rather than the seed silently
 * failing, so the player sees a result and can reason about it instead of losing a turn.
 */
export const L_ALLELES = ["L", "l"] as const;

export type WAllele = (typeof W_ALLELES)[number];
export type H1Allele = (typeof H1_ALLELES)[number];
export type H2Allele = (typeof H2_ALLELES)[number];
export type DAllele = (typeof D_ALLELES)[number];
export type PAllele = (typeof P_ALLELES)[number];
export type IAllele = (typeof I_ALLELES)[number];
export type NAllele = (typeof N_ALLELES)[number];
export type LAllele = (typeof L_ALLELES)[number];

export const PETAL_SHAPE_OF: Record<PAllele, PetalShape> = {
  "P^f": "frilled",
  "P^l": "lobed",
  "P^p": "pointed",
  p: "round",
};

export const INFLORESCENCE_OF: Record<IAllele, Inflorescence> = {
  "I^u": "umbel",
  "I^r": "raceme",
  "I^s": "spike",
  i: "solitary",
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
