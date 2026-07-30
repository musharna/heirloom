import { growPlant } from "../src/growth/sim";
import { mulberry32 } from "../src/rng";
import {
  paintPlant,
  paintSoil,
  paintStage,
  soilLine,
} from "../src/render/stage";
import type { PetalShape, Phenotype, Plant } from "../src/types";

const W = 1180;
// Sized so a full-grown bed roughly fills the frame. At 560 the plants topped out around
// 45% of the height and the composition was two thirds empty sky.
const H = 430;
const PLOTS = 7;

/**
 * A random plausible phenotype.
 *
 * Milestone 2 replaces this with express(genome) — the point here is only to show what the
 * growth engine's range actually looks like. The lookdev sheet deliberately shares ONE seed
 * across every panel to isolate a single gene, which also means it shows the same plant
 * twelve times and hides all of this.
 */
function randomPhenotype(rand: () => number): Phenotype {
  const shapes: PetalShape[] = ["round", "pointed", "lobed", "frilled"];
  const doubled = rand() < 0.3;
  return {
    vigour: 0.35 + 0.65 * rand(),
    droop: rand() < 0.25 ? 0.6 + 0.4 * rand() : 0.1 + 0.25 * rand(),
    phototropism: 0.4 + 0.3 * rand(),
    stiffness: 0.2 + 0.4 * rand(),
    branchiness: 0.25 + 0.7 * rand(),
    baseWidth: 7 + 5 * rand(),
    taper: 0.974 + 0.008 * rand(),
    branchAngle: 0.38 + 0.4 * rand(),
    branchWidthRatio: 0.62 + 0.16 * rand(),
    doubled,
    petalShape: shapes[Math.floor(rand() * shapes.length)]!,
    hueClass: Math.floor(rand() * 5) as 0 | 1 | 2 | 3 | 4,
    white: rand() < 0.16,
    bloomRadius: 15 + 12 * rand(),
  };
}

type Bed = { plant: Plant; startTick: number; maxTick: number };

const canvas = document.getElementById("c") as HTMLCanvasElement;
const statusEl = document.getElementById("status")!;
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
const ctx = canvas.getContext("2d")!;
ctx.scale(dpr, dpr);

let beds: Bed[] = [];
let t = 0;
/** Tick at which the bed finished growing, or null while still growing. */
let doneAtT: number | null = null;
let generation = 0;

function plant(seed: number): void {
  const rand = mulberry32(seed);
  const soil = soilLine(H);
  beds = [];
  for (let i = 0; i < PLOTS; i++) {
    const pheno = randomPhenotype(rand);
    // Spread the plots across the bed, jittered so they are not a metronome, then inset from
    // the edges — a plant's canopy spreads well past its plot, and unclamped jitter was
    // pushing the outer two plants half out of frame.
    const inset = 90;
    const span = W - inset * 2;
    const x =
      inset +
      ((i + 0.5) / PLOTS) * span +
      (rand() - 0.5) * (span / PLOTS) * 0.4;
    const p = growPlant(pheno, Math.floor(rand() * 2 ** 30), { x, y: soil });
    const maxTick = Math.max(
      0,
      ...p.segments.map((s) => s.tick),
      ...p.blooms.map((b) => b.tick),
    );
    // Staggered emergence, so the bed fills in rather than all rising in lockstep.
    beds.push({ plant: p, startTick: Math.floor(rand() * 46), maxTick });
  }
  t = 0;
  doneAtT = null;
  generation++;
}

function frame(): void {
  paintStage(ctx, W, H);

  // Back-to-front by plot x, so overlapping plants layer consistently.
  for (const bed of [...beds].sort((a, b) => a.startTick - b.startTick)) {
    paintPlant(ctx, bed.plant, t - bed.startTick);
  }
  paintSoil(ctx, W, H);

  const done = beds.every((b) => t - b.startTick >= b.maxTick);
  statusEl.textContent = done
    ? `generation ${generation} — grown`
    : `generation ${generation} — growing`;

  // Growth speed: ~1.4 ticks per frame reads as unhurried without being tedious.
  t += 1.4;

  // Hold the finished bed a while, then reseed with fresh genomes.
  //
  // The hold is measured from WHEN the bed finished, not from an absolute tick. Keying it to
  // absolute t meant seeking the clock forward (which the screenshot tool does, to capture a
  // known growth stage) instantly satisfied the hold and triggered a replant — so a capture
  // aimed at the grown bed actually photographed a brand-new generation two frames old.
  if (done) {
    if (doneAtT === null) doneAtT = t;
    if (t - doneAtT > 260) plant(Date.now() & 0x7fffffff);
  } else {
    doneAtT = null;
  }
  requestAnimationFrame(frame);
}

document.getElementById("replant")!.addEventListener("click", () => {
  plant(Date.now() & 0x7fffffff);
});

plant(20260730);
requestAnimationFrame(frame);

// Lets a screenshot tool wait for a specific growth stage instead of guessing.
Object.assign(window as unknown as Record<string, unknown>, {
  __gardenReady: true,
  __gardenSeek: (tick: number) => {
    t = tick;
  },
  __gardenPlant: (seed: number) => plant(seed),
});
