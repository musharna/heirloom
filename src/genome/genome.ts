import {
  D_ALLELES,
  H1_ALLELES,
  H2_ALLELES,
  P_ALLELES,
  POLY_LOCI,
  W_ALLELES,
  popcount,
  type DAllele,
  type H1Allele,
  type H2Allele,
  type PAllele,
  type WAllele,
} from "./loci";

/**
 * One polygenic block: two homologous copies, each a POLY_LOCI-bit mask where a set bit is
 * a `+` allele.
 *
 * Bitmasks rather than boolean arrays because inheritance segregates each of the six loci
 * INDEPENDENTLY, and a bitmask makes that a loop over bit positions. Treating a block as one
 * inseparable haplotype would be the tempting simplification and it is wrong: with no
 * recombination inside the block, a cross could only ever produce four distinct habits, and
 * the "continuous drift" of §5 would collapse into four discrete outcomes.
 */
export type PolyBlock = { a: number; b: number };

export type Genome = {
  W: [WAllele, WAllele];
  H1: [H1Allele, H1Allele];
  H2: [H2Allele, H2Allele];
  D: [DAllele, DAllele];
  P: [PAllele, PAllele];
  V: PolyBlock;
  G: PolyBlock;
  B: PolyBlock;
};

/** Canonical order — serialization depends on it. */
export const DISCRETE_LOCI = ["W", "H1", "H2", "D", "P"] as const;
export const POLY_BLOCKS = ["V", "G", "B"] as const;

export type DiscreteLocus = (typeof DISCRETE_LOCI)[number];
export type PolyBlockName = (typeof POLY_BLOCKS)[number];

export const ALLELES: {
  W: typeof W_ALLELES;
  H1: typeof H1_ALLELES;
  H2: typeof H2_ALLELES;
  D: typeof D_ALLELES;
  P: typeof P_ALLELES;
} = {
  W: W_ALLELES,
  H1: H1_ALLELES,
  H2: H2_ALLELES,
  D: D_ALLELES,
  P: P_ALLELES,
};

const POLY_MASK = (1 << POLY_LOCI) - 1;

/** Combined `+` count across both homologs: 0..MAX_DOSAGE. */
export function dosage(block: PolyBlock): number {
  return popcount(block.a & POLY_MASK) + popcount(block.b & POLY_MASK);
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))]!;
}

/** One allele drawn at random from a diploid pair — a gamete's contribution at one locus. */
function gamete<A>(pair: readonly [A, A], rand: () => number): A {
  return rand() < 0.5 ? pair[0] : pair[1];
}

/**
 * A gamete's haplotype for one polygenic block: each of the six loci independently drawn
 * from one homolog or the other. Free recombination — see the note on PolyBlock.
 */
function polyGamete(block: PolyBlock, rand: () => number): number {
  let out = 0;
  for (let i = 0; i < POLY_LOCI; i++) {
    const src = rand() < 0.5 ? block.a : block.b;
    out |= ((src >> i) & 1) << i;
  }
  return out;
}

function randomPoly(rand: () => number): PolyBlock {
  let a = 0;
  let b = 0;
  for (let i = 0; i < POLY_LOCI; i++) {
    if (rand() < 0.5) a |= 1 << i;
    if (rand() < 0.5) b |= 1 << i;
  }
  return { a, b };
}

export function randomGenome(rand: () => number): Genome {
  return {
    W: [pick(W_ALLELES, rand), pick(W_ALLELES, rand)],
    H1: [pick(H1_ALLELES, rand), pick(H1_ALLELES, rand)],
    H2: [pick(H2_ALLELES, rand), pick(H2_ALLELES, rand)],
    D: [pick(D_ALLELES, rand), pick(D_ALLELES, rand)],
    P: [pick(P_ALLELES, rand), pick(P_ALLELES, rand)],
    V: randomPoly(rand),
    G: randomPoly(rand),
    B: randomPoly(rand),
  };
}

/**
 * A child genome: one gamete from each parent, every locus segregating independently.
 *
 * Parent order matters only to which homolog lands in slot 0 of each pair; the genetics are
 * symmetric.
 */
export function inherit(a: Genome, b: Genome, rand: () => number): Genome {
  return {
    W: [gamete(a.W, rand), gamete(b.W, rand)],
    H1: [gamete(a.H1, rand), gamete(b.H1, rand)],
    H2: [gamete(a.H2, rand), gamete(b.H2, rand)],
    D: [gamete(a.D, rand), gamete(b.D, rand)],
    P: [gamete(a.P, rand), gamete(b.P, rand)],
    V: { a: polyGamete(a.V, rand), b: polyGamete(b.V, rand) },
    G: { a: polyGamete(a.G, rand), b: polyGamete(b.G, rand) },
    B: { a: polyGamete(a.B, rand), b: polyGamete(b.B, rand) },
  };
}

function mutateAllele<A extends string>(
  series: readonly A[],
  allele: A,
  rand: () => number,
  rate: number,
): A {
  if (rand() >= rate) return allele;
  // Draw from the OTHER alleles, so a mutation always changes something. Drawing from the
  // full series would make an n-allele locus mutate only (n-1)/n of the time it fires, and
  // the two-allele loci would silently run at half the stated rate.
  const others = series.filter((x) => x !== allele);
  return others.length ? pick(others, rand) : allele;
}

function mutatePoly(
  block: PolyBlock,
  rand: () => number,
  rate: number,
): PolyBlock {
  let { a, b } = block;
  for (let i = 0; i < POLY_LOCI; i++) {
    if (rand() < rate) a ^= 1 << i;
    if (rand() < rate) b ^= 1 << i;
  }
  return { a, b };
}

export type MutationRates = {
  /** Per allele copy, across the 10 discrete allele copies. */
  discrete: number;
  /** Per bit, across the 36 polygenic bits (3 blocks × 6 loci × 2 homologs). */
  poly: number;
};

/**
 * Two rates, not one, because the two kinds of locus do different jobs.
 *
 * A discrete mutation flips a VISIBLE trait — the flower goes white, or doubles, or changes
 * petal shape. A polygenic bit flips 1/12th of one habit axis, which is invisible on its own
 * and only reads as drift once several accumulate. A single shared rate has to be either too
 * hot for the discrete loci or too cold for the blocks.
 *
 * The counts are what make this bite: 10 discrete copies vs 36 polygenic bits. At these
 * defaults ~86% of clones keep every visible trait while ~2/3 shift habit somewhere, which
 * is the intended feel — a lineage that creeps, punctuated by the occasional real surprise.
 */
export const DEFAULT_MUTATION: MutationRates = { discrete: 0.015, poly: 0.03 };

export function mutate(
  g: Genome,
  rand: () => number,
  rates: MutationRates = DEFAULT_MUTATION,
): Genome {
  const d = rates.discrete;
  return {
    W: [
      mutateAllele(W_ALLELES, g.W[0], rand, d),
      mutateAllele(W_ALLELES, g.W[1], rand, d),
    ],
    H1: [
      mutateAllele(H1_ALLELES, g.H1[0], rand, d),
      mutateAllele(H1_ALLELES, g.H1[1], rand, d),
    ],
    H2: [
      mutateAllele(H2_ALLELES, g.H2[0], rand, d),
      mutateAllele(H2_ALLELES, g.H2[1], rand, d),
    ],
    D: [
      mutateAllele(D_ALLELES, g.D[0], rand, d),
      mutateAllele(D_ALLELES, g.D[1], rand, d),
    ],
    P: [
      mutateAllele(P_ALLELES, g.P[0], rand, d),
      mutateAllele(P_ALLELES, g.P[1], rand, d),
    ],
    V: mutatePoly(g.V, rand, rates.poly),
    G: mutatePoly(g.G, rand, rates.poly),
    B: mutatePoly(g.B, rand, rates.poly),
  };
}

/** Structural equality, for tests and for de-duplicating a seed tray. */
export function genomesEqual(x: Genome, y: Genome): boolean {
  for (const l of DISCRETE_LOCI) {
    if (x[l][0] !== y[l][0] || x[l][1] !== y[l][1]) return false;
  }
  for (const l of POLY_BLOCKS) {
    if (x[l].a !== y[l].a || x[l].b !== y[l].b) return false;
  }
  return true;
}
