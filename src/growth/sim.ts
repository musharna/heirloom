import { mulberry32, angleDelta } from "../rng";
import { layoutBloom } from "./bloom";
import type {
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

export function growPlant(pheno: Phenotype, seed: number, origin: Vec2): Plant {
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
        blooms.push(
          layoutBloom(pheno, tip.pos, tip.dir, rand, openness(tip, rand), tick),
        );
      }
    }

    tips = tips.filter((t) => t.alive).concat(spawned);
  }

  // Any tip still alive when the clock runs out still blooms.
  for (const tip of tips)
    blooms.push(
      layoutBloom(pheno, tip.pos, tip.dir, rand, openness(tip, rand), maxTicks),
    );

  return { segments, blooms, leaves };
}
