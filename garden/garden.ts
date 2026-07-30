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
import { serialize } from "../src/genome/serialize";
import { mulberry32 } from "../src/rng";
import {
  PALETTE,
  paintPlant,
  paintSoil,
  paintStage,
} from "../src/render/stage";
import type { Vec2 } from "../src/types";

const W = 1180;
const H = 560;
/** Deep enough that the tray rests ON the dirt rather than floating below the frame. */
const SOIL = 452;
const PLOTS = 6;
/** Founders occupy half the bed. The empty plots are the invitation to plant something. */
const FOUNDERS = 3;
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
      flash = { at: p, until: now + 34 };
    } else if (travelled < CLICK_SLOP) {
      // CLONE — a click that never became a drag.
      garden = addSeed(garden, cloneOf(d.genome, rand));
      flash = { at: p, until: now + 34 };
    }
    return;
  }

  // A seed was dragged. Onto another seed it splices; onto the bed it plants.
  const onto = seedAt(garden, p, W, H);
  if (onto !== null && onto !== d.id) {
    garden = spliceSeeds(garden, d.id, onto, rand);
    flash = { at: p, until: now + 34 };
    return;
  }
  const plot = plotAt(garden, p);
  // Only a drop above the tray line plants: dragging a seed sideways along the tray is
  // rearranging, not planting, and every x in the bed is within some plot's reach.
  if (plot !== null && p.y < SOIL + 24) {
    garden = plantSeed(garden, d.id, plot, SOIL, now);
    flash = { at: { x: plotXs[plot]!, y: SOIL }, until: now + 34 };
  }
});

canvas.addEventListener("pointerleave", () => {
  pointer = { x: -1, y: -1 };
});

function paintPlotMarker(x: number): void {
  // A shallow divot: enough to read as "something could go here", not enough to look like UI.
  ctx.beginPath();
  ctx.ellipse(x, SOIL + 7, 15, 4.2, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(150,170,152,0.22)";
  ctx.lineWidth = 1;
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

function paintHalo(at: Vec2, r: number, alpha: number): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(232,246,234,${alpha})`;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function frame(): void {
  paintStage(ctx, W, H, SOIL);

  for (const [i, plot] of garden.plots.entries()) {
    if (!plot.occupant) paintPlotMarker(plotXs[i]!);
  }
  for (const plot of garden.plots) {
    if (plot.occupant)
      paintPlant(ctx, plot.occupant.plant, now - plot.occupant.plantedAt);
  }
  paintSoil(ctx, W, H, SOIL);

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
      // Show which plot would receive it, so a drop is never a guess.
      const plot = plotAt(garden, pointer);
      if (plot !== null && pointer.y < SOIL + 24)
        paintHalo({ x: plotXs[plot]!, y: SOIL + 6 }, 20, 0.6);
    } else {
      const onto = bloomAt(garden, pointer, now);
      if (onto && onto.plotIndex !== drag.plotIndex)
        paintHalo(onto.bloom.center, onto.bloom.radius * 1.3, 0.85);
    }
  }

  if (flash && now < flash.until) {
    const k = (flash.until - now) / 34;
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
  if (drag?.kind === "seed") return "drop it on a plot to plant it";
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
