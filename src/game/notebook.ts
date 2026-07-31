import { parseGenome } from "../genome/serialize";
import {
  ALLELES,
  DISCRETE_LOCI,
  type DiscreteLocus,
  type Genome,
} from "../genome/genome";
import {
  INFLORESCENCE_OF,
  PETAL_COUNT_OF,
  PETAL_SHAPE_OF,
  dominant,
} from "../genome/loci";
import { express } from "../genome/express";

/**
 * The field notebook: what the player has SEEN, and what follows from it.
 *
 * The whole design turns on one refusal. It would be trivial to open a plant and print its
 * genotype — the data is right there — and it would destroy the most interesting locus in the
 * game. A carrier is defined by being indistinguishable; handing over `Ll` for free means
 * nobody ever has to breed a plant to find out what it is, and the albinism locus becomes a
 * label rather than a discovery.
 *
 * So this records OBSERVATIONS — which plants were crossed, and what grew — and derives only
 * what those observations entail. An albino seedling proves both its parents carry `l`. That
 * inference is the payoff, and it is available exactly when the player has earned it.
 */

/** One observed cross: a child that was actually grown, and where it came from. */
export type Cross = {
  /** The seed this child grew from. Identity, so a reload cannot double-count it. */
  seedId: number;
  /** Serialized child genome. */
  child: string;
  /** Serialized parents. The same code twice for a self-cross. */
  parents: [string, string];
};

export type Notebook = { crosses: Cross[] };

/**
 * Cap on remembered crosses.
 *
 * Deduction is monotone — evidence never stops being true — so forgetting is a real loss, not
 * a tidy-up. The cap exists only to bound the save, and it is set well past any plausible
 * session rather than at a round number that would bite a patient player.
 */
export const CROSS_CAP = 400;

export const emptyNotebook = (): Notebook => ({ crosses: [] });

/**
 * Record a cross, unless this seed has already been recorded.
 *
 * Keyed on seed id rather than on the genomes involved, because two separate crosses of the
 * same pair are two independent pieces of evidence and must both count, while ONE seed
 * re-observed after a reload or a re-layout is not new evidence at all.
 */
export function recordCross(nb: Notebook, cross: Cross): Notebook {
  if (nb.crosses.some((c) => c.seedId === cross.seedId)) return nb;
  const crosses = [...nb.crosses, cross];
  return {
    crosses: crosses.length > CROSS_CAP ? crosses.slice(-CROSS_CAP) : crosses,
  };
}

/** An allele a plant is known to carry but does not show. */
export type Carried = {
  locus: DiscreteLocus;
  /** Index in the locus's series. The plant carries this allele or a more recessive one. */
  rank: number;
  /** How many observed offspring support the deduction. */
  evidence: number;
};

const parse = (code: string): Genome | null => {
  const r = parseGenome(code);
  return r.ok ? r.genome : null;
};

const rankOf = (locus: DiscreteLocus, g: Genome): number => {
  const series = ALLELES[locus] as readonly string[];
  return series.indexOf(dominant(series, g[locus] as [string, string]));
};

/**
 * What a plant must be carrying, given every offspring of it the player has grown.
 *
 * The rule, once, for all eight discrete loci. A child expresses the most dominant allele it
 * holds, so if a child expresses rank `c`, BOTH of the child's alleles are at rank `c` or
 * more recessive. One of them came from this parent. So if the parent itself expresses
 * something more dominant than `c`, the allele it contributed cannot have been the one it
 * shows — it must carry a second, hidden allele at rank `c` or below.
 *
 * That is the entire inference, and it is why a doubled child from two single parents means
 * something. Note what it does NOT claim: the exact hidden allele. From a frilled parent and a
 * pointed child all that follows is "pointed or plainer", and the notebook says so rather than
 * guessing the rest.
 *
 * One honest caveat, deliberately not corrected for: `crossOf` mutates after inheriting, so
 * roughly one deduction in a few hundred rests on a mutation rather than a hidden allele. The
 * card always shows the supporting count alongside the claim, which is the same thing a real
 * grower would look at — one odd seedling is a curiosity, three is a genotype.
 */
export function carriedBy(nb: Notebook, code: string): Carried[] {
  const parent = parse(code);
  if (!parent) return [];

  const best = new Map<DiscreteLocus, { rank: number; evidence: number }>();

  for (const cross of nb.crosses) {
    if (cross.parents[0] !== code && cross.parents[1] !== code) continue;
    const child = parse(cross.child);
    if (!child) continue;

    for (const locus of DISCRETE_LOCI) {
      const shown = rankOf(locus, parent);
      const inChild = rankOf(locus, child);
      // A child no more recessive than its parent tells us nothing: the parent could have
      // contributed the very allele it shows.
      if (inChild <= shown) continue;
      const at = best.get(locus);
      if (!at || inChild > at.rank)
        best.set(locus, { rank: inChild, evidence: 1 });
      else if (inChild === at.rank) at.evidence++;
    }
  }

  return DISCRETE_LOCI.filter((l) => best.has(l)).map((locus) => ({
    locus,
    rank: best.get(locus)!.rank,
    evidence: best.get(locus)!.evidence,
  }));
}

/** Offspring of this plant that the player has actually grown. */
export function offspringCount(nb: Notebook, code: string): number {
  return nb.crosses.filter(
    (c) => c.parents[0] === code || c.parents[1] === code,
  ).length;
}

const HUE_NAMES = ["crimson", "coral", "magenta", "violet", "blue"] as const;

/** Two or three words for a plant, for naming it as somebody's parent. */
export function shortLabel(code: string): string {
  const g = parse(code);
  if (!g) return "an unknown plant";
  const p = express(g);
  const colour = p.white ? "white" : (HUE_NAMES[p.hueClass] ?? "coral");
  const form = p.inflorescence === "solitary" ? "" : ` ${p.inflorescence}`;
  return `${p.doubled ? "doubled " : ""}${colour}${form}`;
}

/**
 * What the plant is showing, in words.
 *
 * Phrased as observations rather than as gene names. "Five petals" is something the player can
 * check by counting; "N^12/n" is a fact about the implementation, and printing it would turn
 * the card into a debug overlay.
 */
export function describeTraits(code: string): string[] {
  const g = parse(code);
  if (!g) return [];
  const p = express(g);
  if (!p.viable) return ["albino — no chlorophyll; it will not flower"];

  const out = [
    p.white
      ? "white — the pigment block is switched on"
      : `${HUE_NAMES[p.hueClass] ?? "coral"} flowers`,
    `${p.petalCount} petals, ${p.petalShape}${p.doubled ? ", doubled" : ""}`,
    p.inflorescence === "solitary"
      ? "one flower per shoot"
      : `flowers in a ${p.inflorescence}`,
  ];
  return out;
}

/**
 * A deduction, in the same voice as the traits.
 *
 * Each line names the evidence and what follows from it, because the claim is only as good as
 * the count behind it and hiding that would be overstating what the player knows.
 */
export function describeCarried(c: Carried): string {
  const n = c.evidence === 1 ? "1 seedling" : `${c.evidence} seedlings`;
  const series = ALLELES[c.locus] as readonly string[];
  const allele = series[c.rank]!;

  switch (c.locus) {
    case "W":
      return `carries colour beneath the white (${n})`;
    case "D":
      return `carries doubling (${n})`;
    case "L":
      return `carries albinism (${n})`;
    case "H1":
    case "H2":
      return `carries a paler hue than it shows (${n})`;
    case "P":
      return `carries ${PETAL_SHAPE_OF[allele as keyof typeof PETAL_SHAPE_OF]} petals or plainer (${n})`;
    case "I":
      return `carries a ${INFLORESCENCE_OF[allele as keyof typeof INFLORESCENCE_OF]} habit or simpler (${n})`;
    case "N":
      return `carries ${PETAL_COUNT_OF[allele as keyof typeof PETAL_COUNT_OF]} petals or fewer (${n})`;
  }
}
