import { express } from "../src/genome/express";
import { randomGenome, type Genome } from "../src/genome/genome";
import { genomeSeed, serialize } from "../src/genome/serialize";
import { growPlant } from "../src/growth/sim";
import { mulberry32 } from "../src/rng";
import {
  paintPlant,
  paintSoil,
  paintStage,
  soilLine,
} from "../src/render/stage";
import type { Plant } from "../src/types";

const W = 1180;
// Sized so a full-grown bed roughly fills the frame. At 560 the plants topped out around
// 45% of the height and the composition was two thirds empty sky.
const H = 430;
const PLOTS = 7;

type Bed = {
  genome: Genome;
  plant: Plant;
  startTick: number;
  maxTick: number;
};

const canvas = document.getElementById("c") as HTMLCanvasElement;
const statusEl = document.getElementById("status")!;
const codesEl = document.getElementById("codes")!;
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
    const genome = randomGenome(rand);
    // Spread the plots across the bed, jittered so they are not a metronome, then inset from
    // the edges — a plant's canopy spreads well past its plot, and unclamped jitter was
    // pushing the outer two plants half out of frame.
    // 90 was not enough once founders spanned the full droop range: a weeper leans ~45px
    // past its plot, so the outermost one hung its only flower over the frame edge.
    const inset = 135;
    const span = W - inset * 2;
    const x =
      inset +
      ((i + 0.5) / PLOTS) * span +
      (rand() - 0.5) * (span / PLOTS) * 0.4;
    // The growth seed is the GENOME's, never the plot's (§6). A plot-derived seed would grow
    // the same genome differently in each bed, which breaks both share links and lineage
    // recognizability — so the plot only decides WHERE, never WHAT.
    const p = growPlant(express(genome), genomeSeed(genome), { x, y: soil });
    const maxTick = Math.max(
      0,
      ...p.segments.map((s) => s.tick),
      ...p.blooms.map((b) => b.tick),
    );
    // Staggered emergence, so the bed fills in rather than all rising in lockstep.
    beds.push({
      genome,
      plant: p,
      startTick: Math.floor(rand() * 46),
      maxTick,
    });
  }
  t = 0;
  doneAtT = null;
  generation++;
  // Every plant in the bed is now reproducible from eleven characters. Printing them is the
  // cheapest possible check that the share format is wired to what is actually on screen.
  codesEl.textContent = beds.map((b) => serialize(b.genome)).join("  ");
}

function frame(): void {
  paintStage(ctx, W, H);

  // Back-to-front by plot x, so overlapping plants layer consistently.
  for (const bed of [...beds].sort((a, b) => a.startTick - b.startTick)) {
    paintPlant(ctx, bed.plant, t - bed.startTick);
  }
  paintSoil(ctx, W, H);

  const done = beds.every((b) => t - b.startTick >= b.maxTick);
  statusEl.textContent = `generation ${generation} — ${done ? "grown" : "growing"}`;

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
