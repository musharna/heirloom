import type { Inflorescence, Phenotype } from "../types";
import { dosage, type Genome } from "./genome";
import {
  D_ALLELES,
  INFLORESCENCE_OF,
  I_ALLELES,
  L_ALLELES,
  MAX_DOSAGE,
  N_ALLELES,
  PETAL_COUNT_OF,
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

/** Which architecture the `I` series expresses. */
export function inflorescenceOf(g: Genome): Inflorescence {
  return INFLORESCENCE_OF[dominant(I_ALLELES, g.I)];
}

/** Petals per whorl from the `N` series. */
export function petalCountOf(g: Genome): number {
  return PETAL_COUNT_OF[dominant(N_ALLELES, g.N)];
}

/**
 * `ll` — albino. The seedling has no chlorophyll, so it lives on the seed's reserves and dies.
 *
 * Stated as `isViable` rather than `isAlbino` because that is what the rest of the code needs
 * to ask. If a second lethal is ever added, this function grows a clause and nothing else in
 * the codebase has to learn about it.
 */
export function isViable(g: Genome): boolean {
  return dominant(L_ALLELES, g.L) === "L";
}

/**
 * Whether a plant carries albinism WITHOUT showing it.
 *
 * Nothing in the render path uses this — a carrier is by definition indistinguishable. It
 * exists so the tests can state the property that makes the locus worth having: that carriers
 * are common, invisible, and the only route to an albino.
 */
export function isCarrier(g: Genome): boolean {
  return g.L[0] !== g.L[1];
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
    petalCount: petalCountOf(g),
    inflorescence: inflorescenceOf(g),
    hueClass: hueDosage(g),
    white: isWhite(g),
    // Many-flowered architectures carry SMALLER flowers. This is the same trade real plants
    // make — an umbel of forty florets and a solitary peony cost the plant a comparable
    // amount — and without it a twelve-flowered raceme of full-size blooms is simply the best
    // genotype in the game, which would collapse the whole point of open-ended breeding.
    bloomRadius:
      (14 + 9 * (1 - b) + 4 * v) * CLUSTER_SIZE_TRADE[inflorescenceOf(g)],
    viable: isViable(g),
  };
}

/**
 * Per-flower size penalty for carrying many flowers. Solitary pays nothing.
 *
 * Umbels are hit hardest because every floret opens at once at one point; a raceme spreads
 * its flowers along the shoot and over time, so it can afford slightly larger ones.
 */
const CLUSTER_SIZE_TRADE: Record<Inflorescence, number> = {
  solitary: 1,
  raceme: 0.72,
  spike: 0.66,
  umbel: 0.58,
};
