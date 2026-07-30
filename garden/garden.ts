import {
  addSeed,
  cloneOf,
  createGarden,
  crossOf,
  plantSeed,
  sowFounders,
  spliceSeeds,
  type Garden,
} from "../src/game/garden";
import {
  bloomAt,
  plotAt,
  seedAt,
  shownBlooms as bloomsOf,
  traySlot,
} from "../src/game/hit";
import type { Genome } from "../src/genome/genome";
import { genomeSeed, serialize } from "../src/genome/serialize";
import { Forest } from "../src/render/accumulate";
import { mulberry32 } from "../src/rng";
import {
  PALETTE,
  paintPlant,
  paintSoil,
  paintStage,
} from "../src/render/stage";
import type { Vec2 } from "../src/types";

const W = 1180;
/**
 * Sized to what the plants actually occupy, not to a round number. At 520 with the soil at
 * 440 the tallest founder topped out around 40% of the frame and the upper 60% was empty
 * sky — the growth engine's plants are roughly 250px tall, so the headroom above them was
 * larger than the plants themselves.
 */
const H = 470;
/**
 * Deep enough that the tray rests ON the dirt rather than floating below the frame, shallow
 * enough that the band does not become a slab. At 108px it read as a caption strip; the
 * gradient in paintSoil does the rest of the work.
 */
const SOIL = 390;
const PLOTS = 6;
/** Two thirds sown. The empty plots are the invitation to plant something. */
const FOUNDERS = 4;
/** Ticks per frame. Unhurried without being tedious. */
const SPEED = 1.4;

const canvas = document.getElementById("c") as HTMLCanvasElement;
const hintEl = document.getElementById("hint")!;
const codeEl = document.getElementById("code")!;
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
const ctx = canvas.getContext("2d")!;
ctx.scale(dpr, dpr);

const plotXs = Array.from({ length: PLOTS }, (_, i) => {
  const inset = 135;
  return inset + (i / (PLOTS - 1)) * (W - inset * 2);
});

const rand = mulberry32(Date.now() & 0x7fffffff);
let garden: Garden = sowFounders(
  createGarden(plotXs),
  FOUNDERS,
  SOIL,
  mulberry32(20260730),
);
let now = 0;

/**
 * The accumulating background. Everything ever displaced from a plot lives here as pixels.
 *
 * `composited` tracks how many of `garden.retired` have been drawn. Comparing counts each
 * frame — rather than compositing inside the pointer handler — means every path that retires
 * a plant is covered automatically, including any future one.
 */
const forest = new Forest(W, H, dpr);
let composited = 0;

/**
 * What the pointer is currently carrying.
 *
 * A bloom drag doubles as a click: which verb fires is decided on RELEASE, by how far the
 * pointer travelled and what is under it. Deciding on press instead would mean committing to
 * clone before knowing whether the player was starting a cross.
 */
type Drag =
  | { kind: "bloom"; plotIndex: number; genome: Genome; from: Vec2 }
  | { kind: "seed"; id: number; from: Vec2 }
  | null;

let drag: Drag = null;
let pointer: Vec2 = { x: -1, y: -1 };
/** Set briefly after a verb fires, so the player sees that something happened. */
let flash: { at: Vec2; until: number } | null = null;

const CLICK_SLOP = 7;
/** How long the "something happened" ring lives, in ticks. */
const FLASH_TICKS = 34;

function toCanvas(e: PointerEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * W) / r.width,
    y: ((e.clientY - r.top) * H) / r.height,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  const p = toCanvas(e);
  pointer = p;
  canvas.setPointerCapture(e.pointerId);

  const seed = seedAt(garden, p, W, H);
  if (seed !== null) {
    drag = { kind: "seed", id: seed, from: p };
    return;
  }
  const hit = bloomAt(garden, p, now);
  if (hit) {
    drag = {
      kind: "bloom",
      plotIndex: hit.plotIndex,
      genome: garden.plots[hit.plotIndex]!.occupant!.genome,
      from: p,
    };
  }
});

canvas.addEventListener("pointermove", (e) => {
  pointer = toCanvas(e);
});

canvas.addEventListener("pointerup", (e) => {
  const p = toCanvas(e);
  const d = drag;
  drag = null;
  if (!d) return;
  const travelled = Math.hypot(p.x - d.from.x, p.y - d.from.y);

  if (d.kind === "bloom") {
    const onto = bloomAt(garden, p, now);
    if (onto && onto.plotIndex !== d.plotIndex) {
      // CROSS — two different plants.
      const partner = garden.plots[onto.plotIndex]!.occupant!.genome;
      garden = addSeed(garden, crossOf(d.genome, partner, rand));
      flash = { at: p, until: now + FLASH_TICKS };
    } else if (travelled < CLICK_SLOP) {
      // CLONE — a click that never became a drag.
      garden = addSeed(garden, cloneOf(d.genome, rand));
      flash = { at: p, until: now + FLASH_TICKS };
    }
    return;
  }

  // A seed was dragged. Onto another seed it splices; onto the bed it plants.
  const onto = seedAt(garden, p, W, H);
  if (onto !== null && onto !== d.id) {
    garden = spliceSeeds(garden, d.id, onto, rand);
    flash = { at: p, until: now + FLASH_TICKS };
    return;
  }
  const plot = plotAt(garden, p);
  // Only a drop above the tray line plants: dragging a seed sideways along the tray is
  // rearranging, not planting, and every x in the bed is within some plot's reach.
  if (plot !== null && p.y < SOIL + 24) {
    garden = plantSeed(garden, d.id, plot, SOIL, now);
    flash = { at: { x: plotXs[plot]!, y: SOIL }, until: now + FLASH_TICKS };
  }
});

canvas.addEventListener("pointerleave", () => {
  pointer = { x: -1, y: -1 };
});

function paintPlotMarker(x: number): void {
  // A shallow divot: enough to read as "something could go here", not enough to look like UI.
  // Drawn as a dark hollow with a lit lower lip — the same trick the soil crest uses. A bare
  // outline at 0.22 alpha was technically present and effectively invisible against the
  // band, which is the identical mistake the stem contour made against the dark ground.
  ctx.beginPath();
  ctx.ellipse(x, SOIL + 9, 16, 4.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, SOIL + 9, 16, 4.6, 0, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = "rgba(168,190,170,0.42)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function paintSeed(x: number, y: number, lit: boolean): void {
  ctx.beginPath();
  ctx.ellipse(x, y, 5.4, 7.2, 0.5, 0, Math.PI * 2);
  ctx.fillStyle = lit ? "#5c6f5f" : "#3c4a40";
  ctx.fill();
  ctx.strokeStyle = lit ? "rgba(226,244,228,0.85)" : PALETTE.stemRim;
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

const RING_PLANT = "232,246,234";
/** Amber: this drop REPLACES a living plant. */
const RING_REPLACE = "236,196,116";

function paintHalo(at: Vec2, r: number, alpha: number, rgb = RING_PLANT): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${rgb},${alpha})`;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/** The plot a seed drag would land in, or null. Shared by the ring and the hint text. */
function dropTarget(): number | null {
  if (drag?.kind !== "seed") return null;
  const plot = plotAt(garden, pointer);
  return plot !== null && pointer.y < SOIL + 24 ? plot : null;
}

function frame(): void {
  // Composite anything newly retired before drawing, so a replaced plant appears in the
  // background on the same frame it leaves the bed rather than blinking out of existence.
  while (composited < garden.retired.length) {
    const gone = garden.retired[composited]!;
    forest.retire(gone.plant, genomeSeed(gone.genome));
    composited++;
  }

  paintStage(ctx, W, H, SOIL);
  forest.draw(ctx);

  for (const plot of garden.plots) {
    if (plot.occupant)
      paintPlant(ctx, plot.occupant.plant, now - plot.occupant.plantedAt);
  }
  paintSoil(ctx, W, H, SOIL);

  // AFTER the soil, not before. Drawn first, every divot was painted over by the soil band
  // and the empty plots looked identical to bare ground — so the one affordance telling the
  // player where a seed can go was invisible.
  for (const [i, plot] of garden.plots.entries()) {
    if (!plot.occupant) paintPlotMarker(plotXs[i]!);
  }

  // Affordance: ring whatever the pointer could act on right now.
  const hover = drag ? null : bloomAt(garden, pointer, now);
  if (hover) paintHalo(hover.bloom.center, hover.bloom.radius * 1.25, 0.5);

  for (const [i, seed] of garden.tray.entries()) {
    const s = traySlot(i, W, H);
    const carried = drag?.kind === "seed" && drag.id === seed.id;
    if (!carried)
      paintSeed(s.x, s.y, seedAt(garden, pointer, W, H) === seed.id);
  }

  if (drag) {
    // The tether. Without it a cross-drag has no visible connection to its source and reads
    // as nothing happening until the release.
    ctx.beginPath();
    ctx.moveTo(drag.from.x, drag.from.y);
    ctx.lineTo(pointer.x, pointer.y);
    ctx.strokeStyle = "rgba(200,224,205,0.35)";
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    if (drag.kind === "seed") {
      paintSeed(pointer.x, pointer.y, true);
      // Show which plot would receive it, so a drop is never a guess — and in WHICH colour,
      // because dropping onto an occupied plot destroys a living plant. An identical ring for
      // both made the one destructive verb in the game indistinguishable from the safe one.
      const plot = dropTarget();
      if (plot !== null)
        paintHalo(
          { x: plotXs[plot]!, y: SOIL + 6 },
          20,
          0.65,
          garden.plots[plot]!.occupant ? RING_REPLACE : RING_PLANT,
        );
    } else {
      const onto = bloomAt(garden, pointer, now);
      if (onto && onto.plotIndex !== drag.plotIndex)
        paintHalo(onto.bloom.center, onto.bloom.radius * 1.3, 0.85);
    }
  }

  if (flash && now < flash.until) {
    // Clamped. `now < flash.until` bounds k BELOW but not above, so a clock that jumps
    // backwards gives k > 1.29 and an arc radius of -44 — which throws, and a throw inside
    // the rAF callback stops the loop being rescheduled, freezing the entire game with no
    // visible cause. One unclamped interpolation took the whole render loop down.
    const k = Math.min(1, Math.max(0, (flash.until - now) / FLASH_TICKS));
    paintHalo(flash.at, 10 + 34 * (1 - k), 0.55 * k);
  }

  hintEl.textContent = hint();
  codeEl.textContent = garden.tray.length
    ? serialize(garden.tray.at(-1)!.genome)
    : "";

  now += SPEED;
  requestAnimationFrame(frame);
}

function hint(): string {
  if (drag?.kind === "seed") {
    const plot = dropTarget();
    if (plot !== null && garden.plots[plot]!.occupant)
      return "drop here to REPLACE the plant growing in this plot";
    return "drop it on a plot to plant it";
  }
  if (drag?.kind === "bloom") return "drop it on another flower to cross them";
  if (garden.tray.length === 0)
    return "click a flower for a seed · drag one flower onto another to cross";
  return "drag a seed onto a plot to plant it";
}

requestAnimationFrame(frame);

/**
 * Test hooks.
 *
 * These exist so a driver can click a REAL flower through a REAL pointer event rather than
 * calling the verbs directly. Unit tests prove `cloneOf` works on a fixture; they cannot
 * prove a click at a screen coordinate reaches it — pointer capture, canvas scaling and the
 * click-vs-drag threshold all sit between the two and none of them are covered by a fixture.
 */
Object.assign(window as unknown as Record<string, unknown>, {
  __ready: true,
  __seek: (t: number) => {
    now = t;
  },
  __state: () => ({
    tray: garden.tray.length,
    planted: garden.plots.filter((p) => p.occupant).length,
    retired: garden.retired.length,
    empty: garden.plots.findIndex((p) => !p.occupant),
    occupied: garden.plots
      .map((p, i) => (p.occupant ? i : -1))
      .filter((i) => i >= 0),
    forestDepth: forest.depth,
    forestCoverage: forest.coverage(),
  }),
  /** Canvas-space centres of every flower currently on screen. */
  __blooms: () =>
    garden.plots.flatMap((plot, plotIndex) =>
      plot.occupant
        ? bloomsOf(plot.occupant, now).map((b) => ({
            plotIndex,
            x: b.center.x,
            y: b.center.y,
          }))
        : [],
    ),
  __traySlot: (i: number) => traySlot(i, W, H),
  __plotX: (i: number) => plotXs[i],
  __soil: SOIL,
  __size: { w: W, h: H },
});
