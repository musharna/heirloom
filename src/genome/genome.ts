import {
  D_ALLELES,
  H1_ALLELES,
  H2_ALLELES,
  I_ALLELES,
  L_ALLELES,
  N_ALLELES,
  P_ALLELES,
  POLY_LOCI,
  W_ALLELES,
  popcount,
  type DAllele,
  type H1Allele,
  type H2Allele,
  type IAllele,
  type LAllele,
  type NAllele,
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
  I: [IAllele, IAllele];
  N: [NAllele, NAllele];
  L: [LAllele, LAllele];
  V: PolyBlock;
  G: PolyBlock;
  B: PolyBlock;
};

/** Canonical order — serialization depends on it. */
export const DISCRETE_LOCI = [
  "W",
  "H1",
  "H2",
  "D",
  "P",
  "I",
  "N",
  "L",
] as const;
export const POLY_BLOCKS = ["V", "G", "B"] as const;

export type DiscreteLocus = (typeof DISCRETE_LOCI)[number];
export type PolyBlockName = (typeof POLY_BLOCKS)[number];

export const ALLELES: {
  W: typeof W_ALLELES;
  H1: typeof H1_ALLELES;
  H2: typeof H2_ALLELES;
  D: typeof D_ALLELES;
  P: typeof P_ALLELES;
  I: typeof I_ALLELES;
  N: typeof N_ALLELES;
  L: typeof L_ALLELES;
} = {
  W: W_ALLELES,
  H1: H1_ALLELES,
  H2: H2_ALLELES,
  D: D_ALLELES,
  P: P_ALLELES,
  I: I_ALLELES,
  N: N_ALLELES,
  L: L_ALLELES,
};

/**
 * The linkage map: which discrete loci ride the same chromosome, and how far apart.
 *
 * Until now every locus assorted independently, which is the special case where all eight sit
 * on eight different chromosomes. That is a legitimate model and it is also the boring one:
 * with free assortment, ANY combination of traits is reachable from any cross in a couple of
 * generations, so there is no such thing as a hard cross. Nothing is ever a project.
 *
 * Linkage is what makes a breeding goal cost something. Two desirable alleles sitting on
 * OPPOSITE homologs of the same chromosome (repulsion phase) can only be brought together by a
 * crossover in the interval between them, so at r = 0.06 roughly one gamete in seventeen
 * carries both. The player will produce a lot of nearly-right flowers before the recombinant
 * shows up — and it is that near-miss run, not the payoff, that makes the payoff land.
 *
 * `r` is the recombination fraction between adjacent loci in the list: 0 = never separate,
 * 0.5 = indistinguishable from independent.
 */
export type Chromosome = {
  loci: readonly DiscreteLocus[];
  /** One fewer than `loci` — the interval between each adjacent pair. */
  r: readonly number[];
};

export const CHROMOSOMES: readonly Chromosome[] = [
  // Pigment block beside inflorescence. Both are traits you notice from across the room, and
  // linking them means "white, and in an umbel" is a specific goal rather than a coin flip.
  { loci: ["W", "I"], r: [0.12] },
  // Doubling beside petal count — TIGHT. These two are the fullness cluster: doubled triples
  // the whorls, petal count sets each whorl's density, and the extreme of both together is the
  // showiest flower this genome can make. At r = 0.06 it is a real prize.
  { loci: ["D", "N"], r: [0.06] },
  // The two hue loci, loosely linked. Hue is DOSAGE across both, so linking them makes an
  // achieved colour breed truer instead of regressing to the middle every generation. Loose
  // enough (0.3) that the population still explores the range.
  { loci: ["H1", "H2"], r: [0.3] },
  { loci: ["P"], r: [] },
  // Albinism rides alone on purpose. A lethal linked to something desirable would be a trap
  // rather than a discovery — the player would learn "never breed for X" instead of "some of
  // my plants are carriers".
  { loci: ["L"], r: [] },
];

const POLY_MASK = (1 << POLY_LOCI) - 1;

/** Combined `+` count across both homologs: 0..MAX_DOSAGE. */
export function dosage(block: PolyBlock): number {
  return popcount(block.a & POLY_MASK) + popcount(block.b & POLY_MASK);
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))]!;
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

/**
 * Founder allele frequencies. NOT uniform, and the difference is visible on screen.
 *
 * Drawing every allele at 0.5 seems like the neutral choice and is not. Two failures showed
 * up the moment expressed genomes drove the garden instead of hand-written phenotypes:
 *
 *   - `W` is DOMINANT, so frequency 0.5 masks 3/4 of the population. Every founder flower
 *     came out white and the hue loci may as well not have existed.
 *   - `P` is a dominance SERIES, so equal allele frequencies do not give equal shapes. The
 *     top allele shows whenever either copy carries it: 44% frilled, 6% round.
 *
 * The `P` weights below are solved backwards from wanting all four shapes roughly equally
 * often. A shape shows when it is the highest-ranked allele present, so with cumulative
 * frequency C(k) over ranks at-or-below k, P(shape k) = C(k)² − C(k−1)². Setting each to
 * 1/4 gives C = (1, .866, .5) and the weights are the differences.
 */
const FOUNDER = {
  /** P(the pigment-block allele `W`). Low: white must be uncommon enough to be a surprise. */
  W: 0.08,
  /** P(`D`, single). 0.5 leaves a quarter of founders doubled. */
  D: 0.5,
  /** Rank-ordered: frilled, lobed, pointed, round. */
  P: [0.134, 0.159, 0.207, 0.5],
  /**
   * Rank-ordered: umbel, raceme, spike, solitary. Same solve as `P` — a four-allele series
   * under dominance needs these weights, not equal ones, to show all four forms equally often.
   * Founders showing every architecture is the point: the difference between this game and the
   * original has to be visible in the first bed, not four generations in.
   */
  I: [0.134, 0.159, 0.207, 0.5],
  /** Rank-ordered: 12, 8, 6, 5. Same solve again. */
  N: [0.134, 0.159, 0.207, 0.5],
  /**
   * P(the albino allele `l`) among founder GAMETES, before the viability filter below.
   *
   * High enough that carriers are common and the player meets albinism within a session,
   * rather than it being a curiosity they never see. The realized carrier rate after
   * conditioning is measured in the tests, not asserted here — it is a consequence of the
   * filter, and deriving it on paper is how a comment goes quietly out of date.
   */
  L: 0.3,
} as const;

function weighted<T>(
  items: readonly T[],
  weights: readonly number[],
  rand: () => number,
): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/**
 * A founder polygenic block: draw ONE frequency for the whole block, then every locus at
 * that frequency.
 *
 * The hierarchical draw is the whole point. Twelve fair coins is a binomial concentrated on
 * dosage 6 — sd 1.7 out of a 0..12 range — so every founder came out with the same mid-range
 * habit and the bed read as seven copies of one plant. Drawing p ~ U(0,1) first makes the
 * marginal dosage distribution exactly UNIFORM over 0..12 (a beta(1,1)-binomial), which is
 * the spread a founder collection of distinct cultivars actually has.
 *
 * This is a statement about FOUNDERS only. Once breeding starts, `inherit` mixes blocks
 * locus-by-locus and the population drifts back toward a normal distribution — which is
 * correct, and is what makes selection feel like it is doing something.
 */
function randomPoly(rand: () => number): PolyBlock {
  const p = rand();
  let a = 0;
  let b = 0;
  for (let i = 0; i < POLY_LOCI; i++) {
    if (rand() < p) a |= 1 << i;
    if (rand() < p) b |= 1 << i;
  }
  return { a, b };
}

export function randomGenome(rand: () => number): Genome {
  // One hue frequency per founder, for the same reason as the polygenic blocks: four fair
  // coins would pile 3/8 of the population into hue class 2 and leave 1/16 at each end.
  const hueP = rand();
  const hue = <A extends string>(pair: readonly [A, A]): A =>
    rand() < hueP ? pair[0] : pair[1];

  return {
    W: [
      weighted(W_ALLELES, [FOUNDER.W, 1 - FOUNDER.W], rand),
      weighted(W_ALLELES, [FOUNDER.W, 1 - FOUNDER.W], rand),
    ],
    H1: [hue(H1_ALLELES), hue(H1_ALLELES)],
    H2: [hue(H2_ALLELES), hue(H2_ALLELES)],
    D: [
      weighted(D_ALLELES, [FOUNDER.D, 1 - FOUNDER.D], rand),
      weighted(D_ALLELES, [FOUNDER.D, 1 - FOUNDER.D], rand),
    ],
    P: [
      weighted(P_ALLELES, FOUNDER.P, rand),
      weighted(P_ALLELES, FOUNDER.P, rand),
    ],
    I: [
      weighted(I_ALLELES, FOUNDER.I, rand),
      weighted(I_ALLELES, FOUNDER.I, rand),
    ],
    N: [
      weighted(N_ALLELES, FOUNDER.N, rand),
      weighted(N_ALLELES, FOUNDER.N, rand),
    ],
    L: founderL(rand),
    V: randomPoly(rand),
    G: randomPoly(rand),
    B: randomPoly(rand),
  };
}

/**
 * A founder's chlorophyll genotype — drawn freely, then filtered so it is never `ll`.
 *
 * This is ascertainment, not a fudge. A founder collection is a collection of plants that
 * GREW: an albino seedling dies before anyone could have collected seed from it, so `ll`
 * cannot be present at generation zero by definition. Skipping the filter would open the
 * garden with a dead seedling in a plot and no way to reason about why.
 *
 * Carriers, on the other hand, are invisible and stay in — which is the entire point.
 */
function founderL(rand: () => number): [LAllele, LAllele] {
  const draw = (): LAllele =>
    weighted(L_ALLELES, [1 - FOUNDER.L, FOUNDER.L], rand);
  const pair: [LAllele, LAllele] = [draw(), draw()];
  // Re-draw the second copy rather than forcing it, so the filter does not pin one slot to a
  // constant and skew what a carrier's serialized form looks like.
  while (pair[0] === "l" && pair[1] === "l") pair[1] = draw();
  return pair;
}

/** One allele per discrete locus — what a single gamete carries. */
export type Haplotype = { [K in DiscreteLocus]: Genome[K][0] };

/**
 * Meiosis across the discrete loci: walk each chromosome once, switching homolog at each
 * interval with that interval's recombination fraction.
 *
 * The walk is the whole model. Picking a starting homolog at random and then only ever
 * switching by chance is what produces both parental types at high frequency and both
 * recombinant types at low frequency — and it degrades gracefully: a one-locus chromosome is
 * a fair coin, and an interval at r = 0.5 is indistinguishable from independent assortment,
 * so the old behaviour is a special case of this one rather than something it replaced.
 *
 * Only ONE crossover per interval is modelled. Real meiosis can cross twice in a long
 * interval and land back where it started, but that is already what r < 0.5 encodes, and
 * modelling it explicitly would need a map distance and a mapping function for no visible
 * difference at these distances.
 */
export function meiosis(g: Genome, rand: () => number): Haplotype {
  const out: Record<string, string> = {};
  for (const chrom of CHROMOSOMES) {
    let onA = rand() < 0.5;
    for (let i = 0; i < chrom.loci.length; i++) {
      if (i > 0 && rand() < chrom.r[i - 1]!) onA = !onA;
      const locus = chrom.loci[i]!;
      out[locus] = g[locus][onA ? 0 : 1];
    }
  }
  return out as Haplotype;
}

/**
 * A child genome: one gamete from each parent.
 *
 * Parent order matters only to which homolog lands in slot 0 of each pair; the genetics are
 * symmetric. The polygenic blocks still assort freely — they are quantitative habit axes with
 * no reason to sit anywhere in particular, and linking them would turn "the plant got a bit
 * bushier" into a discrete jump.
 */
export function inherit(a: Genome, b: Genome, rand: () => number): Genome {
  const x = meiosis(a, rand);
  const y = meiosis(b, rand);
  return {
    W: [x.W, y.W],
    H1: [x.H1, y.H1],
    H2: [x.H2, y.H2],
    D: [x.D, y.D],
    P: [x.P, y.P],
    I: [x.I, y.I],
    N: [x.N, y.N],
    L: [x.L, y.L],
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
  /** Per allele copy, across the 16 discrete allele copies (8 loci × 2 homologs). */
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
 * The counts are what make this bite: 16 discrete copies vs 36 polygenic bits. The rates were
 * left alone when the gene set grew from five discrete loci to eight, which does raise the
 * chance a clone shows SOME visible change — the tests measure it rather than this comment
 * asserting it, because that arithmetic is exactly the kind that goes quietly stale.
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
    I: [
      mutateAllele(I_ALLELES, g.I[0], rand, d),
      mutateAllele(I_ALLELES, g.I[1], rand, d),
    ],
    N: [
      mutateAllele(N_ALLELES, g.N[0], rand, d),
      mutateAllele(N_ALLELES, g.N[1], rand, d),
    ],
    // Albinism mutates like anything else, including INTO existence on a clone. A spontaneous
    // albino from a lineage with no history of it is a real event and worth not special-casing
    // away — it is the same surprise a grower gets, arriving by the same mechanism.
    L: [
      mutateAllele(L_ALLELES, g.L[0], rand, d),
      mutateAllele(L_ALLELES, g.L[1], rand, d),
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
