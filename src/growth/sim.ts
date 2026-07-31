import { mulberry32, angleDelta } from "../rng";
import { layoutBloom } from "./bloom";
import type {
  Inflorescence,
  Phenotype,
  Plant,
  StrokeSegment,
  Tip,
  Vec2,
  Bloom,
  LeafSpec,
} from "../types";

const MIN_WIDTH = 0.6;
const MAX_TIPS = 400;
const LEAF_EVERY = 7;
const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

/**
 * Hard ceiling on flowers per plant.
 *
 * Solitary plants never come near it — a bushy one carries perhaps fifty. It exists for the
 * combination the player is actively trying to breed: maximum branchiness carrying a raceme
 * on every shoot, where flower count is a product of two genes rather than a sum. Each bloom
 * is up to 48 petal paths, all redrawn every frame while the plant animates in, so an
 * uncapped extreme genotype does not look impressive — it drops the frame rate and the plant
 * appears to grow in slow motion, which reads as a bug rather than as a prize.
 */
const MAX_BLOOMS = 200;

/** Ticks between lateral flowers along a shoot. Zero for architectures that have none. */
const LATERAL_EVERY: Record<Inflorescence, number> = {
  solitary: 0,
  umbel: 0,
  raceme: 6,
  // Tighter than a raceme: a spike's flowers sit directly on the stem with no stalk between
  // them, so they can pack closer before they collide.
  spike: 5,
};

/**
 * How far a flower at this tip has opened, 0..1.
 *
 * Distal shoots carry younger flowers, so a real inflorescence shows open faces low and
 * inward, and tight buds at the growing tips. Every bloom opening to 1.0 made a flower head
 * read as a sheet of identical stickers.
 */
function openness(tip: Tip, rand: () => number): number {
  const byDepth = 1 - 0.2 * tip.depth;
  const jitter = 0.62 + 0.38 * rand();
  return Math.min(1, Math.max(0.3, byDepth * jitter));
}

/**
 * An albino seedling: it germinates, spends the seed's reserves, and dies.
 *
 * A separate function rather than a flag threaded through the main loop, because almost
 * nothing about it is the same — no branching, no leaves, no flowers, no tropism worth
 * modelling over so few ticks. It still produces a real Plant with real segments, because it
 * still occupies a plot and the player still has to look at it. That is the whole design: the
 * failure is VISIBLE and sits in the bed as evidence, rather than a seed quietly doing nothing.
 */
function growAlbino(pheno: Phenotype, seed: number, origin: Vec2): Plant {
  const rand = mulberry32(seed);
  const segments: StrokeSegment[] = [];
  // Short and getting shorter: reserves run out. Never enough height to look like a young
  // healthy plant that might still make it.
  const ticks = 9 + Math.floor(rand() * 5);
  let pos = { ...origin };
  let dir = UP;
  let width = pheno.baseWidth * 0.45;

  for (let tick = 0; tick < ticks; tick++) {
    dir += (rand() - 0.5) * 0.3;
    // Each step shorter than the last — the shoot visibly gives up rather than being cut off
    // mid-stride at an arbitrary tick count.
    const len = 3.4 * (1 - tick / ticks);
    const nx = pos.x + Math.cos(dir) * len;
    const ny = pos.y + Math.sin(dir) * len;
    const w1 = width * 0.9;
    segments.push({
      x0: pos.x,
      y0: pos.y,
      x1: nx,
      y1: ny,
      w0: width,
      w1,
      depth: 0,
      tick,
      chain: 0,
    });
    pos = { x: nx, y: ny };
    width = w1;
  }

  return { segments, blooms: [], leaves: [], albino: true };
}

export function growPlant(pheno: Phenotype, seed: number, origin: Vec2): Plant {
  if (!pheno.viable) return growAlbino(pheno, seed, origin);

  const rand = mulberry32(seed);
  const segments: StrokeSegment[] = [];
  const blooms: Bloom[] = [];
  const leaves: LeafSpec[] = [];

  const maxTicks = Math.round(40 + 60 * pheno.vigour);
  // Sized so a max-vigour plant traces roughly 350 units — the scale of one garden plot.
  // At the original 3 + 5*vigour a vigorous plant traced ~800 units and grew clean off a
  // 340px canvas, taking its bloom with it.
  const stepLen = 1.6 + 2.4 * pheno.vigour;
  let nextId = 0;
  let leafParity = 0;
  let flowerParity = 0;
  const lateralEvery = LATERAL_EVERY[pheno.inflorescence];

  /** Add a flower unless the plant is already at its ceiling. */
  const addBloom = (b: Bloom): void => {
    if (blooms.length < MAX_BLOOMS) blooms.push(b);
  };

  /**
   * A flower's stalk, drawn as a stem chain of its own.
   *
   * Given its own `chain` id so the outline builder treats it as a separate stroke. Appending
   * it to the parent's chain would smooth the pedicel INTO the stem and produce one fat
   * S-bend where there should be a stem with something attached to it.
   */
  const pedicel = (
    from: Vec2,
    to: Vec2,
    parentWidth: number,
    depth: number,
    tick: number,
  ): void => {
    const w0 = Math.min(parentWidth * 0.42, 2.4);
    segments.push({
      x0: from.x,
      y0: from.y,
      x1: to.x,
      y1: to.y,
      w0,
      w1: w0 * 0.72,
      depth,
      tick,
      chain: nextId++,
    });
  };

  /**
   * How open a flower borne at `tick` is by the end of the plant's life.
   *
   * A raceme ripens ACROPETALLY — bottom first, because the bottom flower is the oldest. That
   * gradient is the signature of the architecture: a foxglove is recognisable as open bells
   * below and tight buds at the tip, and a raceme with every flower equally open reads as a
   * stick with stickers on it rather than as a raceme.
   */
  const ripeness = (tick: number): number =>
    Math.min(
      1,
      Math.max(0.32, (1 - tick / maxTicks) * 1.2 * (0.86 + 0.28 * rand())),
    );

  /**
   * Flowers borne along the side of a shoot — the raceme and spike architectures.
   *
   * The difference between the two is entirely the pedicel: a raceme's flowers stand off the
   * stem on stalks, a spike's sit flush against it. That single number is why foxglove and
   * plantain look nothing alike despite the same underlying arrangement.
   */
  const lateralFlower = (tip: Tip, tick: number): void => {
    const side = (flowerParity++ & 1) === 0 ? 1 : -1;
    const stalk =
      pheno.inflorescence === "spike"
        ? pheno.bloomRadius * 0.2
        : pheno.bloomRadius * (0.95 + 0.35 * rand());
    const ang = tip.dir + side * (0.95 + 0.25 * rand());
    const at = {
      x: tip.pos.x + Math.cos(ang) * stalk,
      y: tip.pos.y + Math.sin(ang) * stalk,
    };
    if (stalk > 1.5) pedicel(tip.pos, at, tip.width, tip.depth + 1, tick);
    addBloom(layoutBloom(pheno, at, ang, rand, ripeness(tick), tick));
  };

  /**
   * What a shoot does when it stops growing.
   *
   * An umbel puts every flower on its own ray from ONE point, which is why cow parsley reads
   * as a plate rather than as a spray. Raceme and spike terminate in a bud instead of an open
   * flower — they flower from the bottom up, so the tip is always the youngest thing on the
   * plant and has not opened yet.
   */
  const terminate = (tip: Tip, tick: number): void => {
    if (pheno.inflorescence === "umbel") {
      const rays = 5 + Math.floor(rand() * 3);
      // Umbels open together, not in sequence — the synchrony IS the look.
      const open = Math.min(1, 0.74 + 0.3 * rand());
      for (let k = 0; k < rays; k++) {
        const ang =
          tip.dir + ((k / (rays - 1) - 0.5) * 2 - 0.06 + 0.12 * rand()) * 0.95;
        // Ray length is set against the FLORET's own radius, and the multiplier is not free:
        // adjacent florets are separated by roughly `len * angularStep`, and the renderer
        // culls any bloom sitting closer to another than 0.62 of a radius. At the first
        // multiplier (1.35–1.95) that arc came out at 5.7px against a 5.8px threshold, so a
        // third of every umbel's florets were grown and then quietly dropped before being
        // drawn — the one architecture defined by its flowers touching was the one the culler
        // ate. Widening the plate fixes it at the geometry rather than by weakening a cull
        // that solitary flowers still need.
        const len = pheno.bloomRadius * (1.75 + 0.55 * rand());
        const at = {
          x: tip.pos.x + Math.cos(ang) * len,
          y: tip.pos.y + Math.sin(ang) * len,
        };
        pedicel(tip.pos, at, tip.width, tip.depth, tick);
        addBloom(layoutBloom(pheno, at, ang, rand, open, tick));
      }
      return;
    }
    const open = lateralEvery > 0 ? 0.36 + 0.14 * rand() : openness(tip, rand);
    addBloom(layoutBloom(pheno, tip.pos, tip.dir, rand, open, tick));
  };

  let tips: Tip[] = [
    {
      id: nextId++,
      pos: { ...origin },
      dir: UP,
      // A branchier plant carries more canopy, so its trunk is thicker (pipe-model
      // reasoning). Without this, the max-branching plant grew 3.2x the flower mass on a
      // trunk THINNER than baseline's and read as "a pink cloud balanced on a stick".
      // 0.6 was far too weak to read: the max-branching trunk measured 16px against
      // baseline's 14px while carrying 2.8x the canopy area.
      width: pheno.baseWidth * (1 + 1.3 * pheno.branchiness),
      age: 0,
      depth: 0,
      vigourLeft: maxTicks,
      alive: true,
      cleared: false,
    },
  ];

  for (let tick = 0; tick < maxTicks; tick++) {
    if (tips.length === 0) break;
    const spawned: Tip[] = [];

    for (const tip of tips) {
      // 1. Tropisms — gravitropism pulls toward DOWN, phototropism toward UP.
      //    They oppose each other, which is what makes droop read as a habit.
      //
      //    Gravitropism RAMPS IN with shoot age. A young shoot is effectively negatively
      //    gravitropic: it rises first, and only the older, longer, heavier shoot arches
      //    over. Applying full droop from tick 0 made a max-droop plant turn downward at
      //    its own base, so it grew down out of mid-air instead of weeping.
      //    The ramp is deliberately LONG — roughly half the shoot's life. Ramping over
      //    only ~14 ticks meant a weeping plant rose barely 40 units before arching, so it
      //    flopped straight back to the ground and read as a stub. Weeping habit is a tall
      //    shoot with a pendant tip, not a short arch.
      //    Ramp lengthened again and the coefficient softened: at /34 and 0.09 a weeping
      //    plant still lost 40% of its height and landed in the same size class as the
      //    low-vigour phenotype, so droop was confounding with vigour. Droop must change
      //    the SHAPE of the shoot, not how tall it gets.
      const droopRamp = Math.min(1, tip.age / 52);
      const turn =
        pheno.droop * droopRamp * 0.062 * angleDelta(tip.dir, DOWN) +
        pheno.phototropism * 0.05 * angleDelta(tip.dir, UP) +
        (rand() - 0.5) * 0.25;
      tip.dir += turn * (1 - pheno.stiffness * 0.7);

      // 2. Step
      const len = stepLen * Math.max(0.35, 1 - 0.06 * tip.depth);
      const nx = tip.pos.x + Math.cos(tip.dir) * len;
      const ny = tip.pos.y + Math.sin(tip.dir) * len;

      // 3. Taper
      const w1 = tip.width * pheno.taper;

      segments.push({
        x0: tip.pos.x,
        y0: tip.pos.y,
        x1: nx,
        y1: ny,
        w0: tip.width,
        w1,
        depth: tip.depth,
        tick,
        chain: tip.id,
      });

      tip.pos = { x: nx, y: ny };
      tip.width = w1;
      tip.age++;
      tip.vigourLeft--;

      // 3b. Leaves, alternating sides at every Nth node (137.5deg phyllotaxy read in 2D
      //     as simple alternation). Foliage is what a branching habit expresses itself
      //     THROUGH: with bare stems, a max-branching plant collapses into an
      //     undifferentiated mass of flowers instead of reading as a bushy plant.
      if (tip.age % LEAF_EVERY === 0 && tip.width > MIN_WIDTH * 2.2) {
        const side = (leafParity++ & 1) === 0 ? 1 : -1;
        // Scaled against bloomRadius, not against stem width. At a quarter of bloom size
        // the foliage rendered as dark flecks on the stem and contributed nothing to the
        // silhouette — on a real plant a leaf is comparable to a flower.
        const scale = pheno.bloomRadius * (0.62 + 0.5 * pheno.vigour);
        leaves.push({
          attach: { x: tip.pos.x, y: tip.pos.y },
          angle: tip.dir + side * (0.85 + 0.25 * rand()),
          length: scale * (1 - 0.1 * tip.depth) * (0.85 + 0.3 * rand()),
          width: scale * 0.52 * (1 - 0.1 * tip.depth),
          tick,
          // Per-leaf variation seed. Length and angle alone were not enough: every blade was
          // the same outline at a different size, which at magnification reads as one stamp
          // repeated rather than as foliage. This drives blade fatness, serration and curl.
          seed: rand(),
          // Which way the blade curls. Following the attachment side keeps a leaf bending
          // away from its own stem rather than folding back through it.
          side,
        });
      }

      // 3c. Lateral flowers. A raceme or spike carries flowers ALONG the shoot rather than
      //     only at its tip, which is what turns one flower per stem into a flower head — and
      //     it is the single change that makes two plants of the same colour distinguishable
      //     from across the room, which no amount of petal work achieves.
      //
      //     Gated on width, not only on age: a shoot thin enough to be a twig cannot hold a
      //     flower off to the side, and without the gate the outermost twigs of a bushy
      //     raceme sprouted flowers larger than the stem carrying them.
      if (
        lateralEvery > 0 &&
        tip.age > 4 &&
        tip.age % lateralEvery === 0 &&
        tip.width > MIN_WIDTH * 1.9
      ) {
        lateralFlower(tip, tick);
      }

      // 4. Branch
      //    Probability spans a WIDE range across the gene. At the old 0.08 ceiling the
      //    difference between a mid and a max branchiness was 0.044 vs 0.08 per tick —
      //    too narrow a window for the same RNG stream to land in, so a "bushy" plant
      //    came out visually identical to its baseline.
      if (
        tips.length + spawned.length < MAX_TIPS &&
        tip.age > 3 &&
        rand() < Math.pow(pheno.branchiness, 1.4) * 0.17
      ) {
        const side = rand() < 0.5 ? 1 : -1;
        spawned.push({
          id: nextId++,
          pos: { ...tip.pos },
          dir: tip.dir + side * pheno.branchAngle,
          width: tip.width * pheno.branchWidthRatio,
          age: 0,
          depth: tip.depth + 1,
          vigourLeft: Math.max(1, Math.round(tip.vigourLeft * 0.7)),
          alive: true,
          // A branch is born already clear of the ground if its parent was.
          cleared: tip.cleared,
        });
      }

      // 5. Terminate -> bloom.
      //    A shoot that arches all the way back down to ground level stops there; it
      //    cannot grow underground. Without this a max-droop plant kept curving past
      //    horizontal and hung well below its own base, which framed as a clipped plant
      //    dangling off the bottom of its plot.
      //    Stop a bloom's RADIUS clear of the ground, not just its centre — otherwise a
      //    pendant bloom sank into the soil band and was sliced by the panel edge.
      //    The rule only applies AFTER the tip has cleared the ground zone. Gating on age
      //    alone killed every plant on its fourth tick, because a shoot starts at ground
      //    level and had not yet risen a bloom-radius above it.
      const groundY = origin.y - pheno.bloomRadius * 0.9;
      if (tip.pos.y < groundY) tip.cleared = true;
      const reachedGround = tip.cleared && tip.pos.y >= groundY;
      if (tip.width < MIN_WIDTH || tip.vigourLeft <= 0 || reachedGround) {
        tip.alive = false;
        terminate(tip, tick);
      }
    }

    tips = tips.filter((t) => t.alive).concat(spawned);
  }

  // Any tip still alive when the clock runs out still blooms.
  for (const tip of tips) terminate(tip, maxTicks);

  return { segments, blooms, leaves, albino: false };
}
