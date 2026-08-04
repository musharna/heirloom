import {
  addSeed,
  cloneOf,
  createGarden,
  crossOf,
  grow,
  isGrown,
  plantSeed,
  sowFounders,
  spliceSeeds,
  TRAY_CAP,
  type Garden,
  type Origin,
  type Planting,
} from "../src/game/garden";
import {
  carriedBy,
  describeCarried,
  describeTraits,
  emptyNotebook,
  offspringCount,
  recordCross,
  shortLabel,
  type Notebook,
} from "../src/game/notebook";
import {
  bloomAt,
  plotAt,
  seedAt,
  shownBlooms as bloomsOf,
  traySlot,
} from "../src/game/hit";
import {
  BACKGROUND_REPLAY,
  computeLayout,
  layoutChanged,
  type Layout,
} from "../src/game/layout";
import { packPostcard, visitPath } from "../src/game/postcard";
import {
  REPLAY_CAP,
  SAVE_KEY,
  fromSave,
  toSave,
  type ReplayEntry,
} from "../src/game/save";
import {
  carrierLabel,
  grownLine,
  plotLabel,
  seedLabel,
} from "../src/game/describe";
import {
  CARRIER_INTERVAL_TICKS,
  canCarrierArrive,
  didPollinate,
  pickPollen,
} from "../src/game/pollinator";
import {
  drawInsects,
  insects,
  removeInsect,
  spawnAmbient,
  spawnCarrier,
  takeExpired,
  updateInsects,
  type Insect,
} from "./insects";
import {
  announce,
  focusedTarget,
  mountMirror,
  syncMirror,
  type Target,
} from "./a11y";
import type { Genome } from "../src/genome/genome";
import { genomeSeed, parseGenome, serialize } from "../src/genome/serialize";
import { Forest } from "../src/render/accumulate";
import { paintThumb } from "../src/render/thumb";
import {
  GROWTH_TICKS_PER_SECOND,
  MOTION_TICKS_PER_SECOND,
  RECEDE_TICKS,
  ticksElapsed,
} from "../src/render/motion";
import { placeRetired, type Placement } from "../src/render/forest";
import { bedDepth, toCanvasSpace, toPlotSpace } from "../src/render/bed";
import { mulberry32 } from "../src/rng";
import { PALETTE, paintPlant } from "../src/render/stage";
import { drawScene, sharedAge } from "../src/scene";
import type { Plant, Vec2 } from "../src/types";

/**
 * World geometry, from the viewport. Reassignable rather than constant: a phone rotated to
 * landscape is a genuinely different garden, not the same garden shrunk.
 */
let {
  W,
  H,
  soil: SOIL,
  plotXs,
} = computeLayout(window.innerWidth, window.innerHeight);
/** Two thirds of the bed sown. The empty plots are the invitation to plant something. */
const foundersFor = (plots: number): number =>
  Math.max(1, Math.round(plots * 0.67));

const canvas = document.getElementById("c") as HTMLCanvasElement;
const hintEl = document.getElementById("hint")!;
const codeEl = document.getElementById("code")!;
const dpr = Math.min(2, window.devicePixelRatio || 1);
const ctx = canvas.getContext("2d")!;

/**
 * Size the canvas box to the viewport WITHOUT distorting it.
 *
 * The CSS was `max-width: 100vw` against an inline `height: 470px`. On a phone that clamps
 * the width to 412 and leaves the height alone, so 1180x470 of content — aspect 2.51 — was
 * being painted into a box of aspect 0.88: a 2.9x horizontal squash. It looked fine on every
 * desktop viewport, which is why it survived until the site was reachable from a phone.
 *
 * Both dimensions are set from ONE scale factor, so the box can never disagree with the
 * drawing buffer's proportions whatever the viewport does. Never magnifies past 1: the art is
 * authored at this size and upscaling it just softens the linework.
 */
function fitCanvas(): void {
  const margin = 8;
  const scale = Math.min(
    1,
    (window.innerWidth - margin * 2) / W,
    (window.innerHeight - 74) / H, // leave the HUD its line
  );
  canvas.style.width = `${Math.round(W * scale)}px`;
  canvas.style.height = `${Math.round(H * scale)}px`;
}

/** Resizing a canvas RESETS its transform, so the dpr scale has to be re-applied. */
function applyCanvasSize(): void {
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  fitCanvas();
}
applyCanvasSize();

const rand = mulberry32(Date.now() & 0x7fffffff);

/**
 * The running retirement history.
 *
 * Owned here rather than read back off `garden.retired`, because a restored garden's `retired`
 * is empty — its plants went straight into the background buffer. Deriving the save from it
 * would write an empty replay on the first save after every reload and erase the player's
 * history one session at a time.
 */
let retirementLog: ReplayEntry[] = [];
/** Non-empty while something needs saying out loud — a rejected save or a bad share link. */
let notice = "";

/**
 * The field notebook: every cross the player has grown out.
 *
 * Owned here for the same reason as `retirementLog` — it is running history, and anything
 * derived from the current garden state would be wiped by the first reload.
 */
let notebook: Notebook = emptyNotebook();

let garden: Garden;
let restored: { genome: Genome; x: number }[] = [];

/**
 * `#new` starts a fresh garden.
 *
 * There was no way to do this at all. The game has no menus by design, the save restores
 * automatically, and — since the save is now flushed on `pagehide` so a phone user who swipes
 * the app away keeps their work — clearing storage from the console and reloading did not work
 * either: the flush fired during the reload and wrote the garden straight back over the clear.
 * Measured on the live site, that recipe returned the SAME garden. A player had no way to start
 * over that did not involve knowing all of the above.
 *
 * A URL fragment rather than a button, because `#g=` already establishes fragments as this
 * game's way of doing things that need no UI, and because the alternative is a permanent
 * "delete everything" control sitting on a screen whose whole design is that it has no
 * controls.
 *
 * It CONFIRMS, and that is not politeness. A fragment travels: paste a link with `#new` on the
 * end into a chat and every person who opens it loses their garden. The deliberate act of
 * typing it is not the same as the deliberate act of clicking it, so the second one is asked
 * for separately.
 *
 * Runs before the save is read, so nothing has been loaded to be written back.
 */
const WANTS_FRESH = /[#&]new(&|$)/;
const RESET_PROMPT =
  "Start a fresh garden?\n\nEverything you have bred — the plants, the seeds, the " +
  "background and the notebook — is deleted. This cannot be undone.";

/** Drop the fragment, so a refresh does not ask again. */
function clearFragment(): void {
  window.history.replaceState(null, "", location.pathname + location.search);
}

/** Ask, and wipe the save if the answer is yes. Returns whether it was wiped. */
function confirmAndWipe(): boolean {
  const ok = window.confirm(RESET_PROMPT);
  clearFragment();
  if (!ok) return false;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    // Storage can be unavailable. Say so rather than pretending the garden was reset.
    console.error("[heirloom] could not clear the saved garden:", e);
    return false;
  }
  return true;
}

function takeFreshStart(): boolean {
  if (!WANTS_FRESH.test(location.hash)) return false;
  return confirmAndWipe();
}

const freshStart = takeFreshStart();

/**
 * `#new` typed into the address bar of a page that is ALREADY open.
 *
 * Which is how a player would actually do it — and it is a same-document navigation, so the
 * page does not reload and nothing that runs at module init ever sees it. The driver caught
 * this: from a fresh tab `#new` worked, and from an open garden it did nothing at all, which
 * is the path a person is far more likely to take.
 *
 * Reloading is the honest way to apply it. Saving is suppressed first, because the pagehide
 * flush would otherwise write the garden back out over the file that was just deleted — the
 * same trap that made clearing storage from the console useless.
 */
window.addEventListener("hashchange", () => {
  if (!WANTS_FRESH.test(location.hash)) return;
  if (!confirmAndWipe()) return;
  suppressSave = true;
  location.reload();
});

// The teaching record deliberately SURVIVES a fresh start. Someone asking for a new garden
// knows how to plant a seed; replaying the first-run lessons at them would be the game failing
// to notice what they had already done.
const stored = freshStart ? null : localStorage.getItem(SAVE_KEY);
if (stored) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (e) {
    parsed = null;
    notice = `saved garden is not valid JSON: ${(e as Error).message}`;
  }
  const loaded = parsed === null ? null : fromSave(parsed, plotXs, SOIL);
  if (loaded?.ok) {
    garden = loaded.garden;
    // The background composites only the shallowest slice, because each entry it takes costs a
    // full growPlant on load. The DRAWER keeps the whole list — it renders lazily, so depth
    // there is free until someone scrolls to it.
    restored = loaded.replay.slice(-BACKGROUND_REPLAY);
    notebook = loaded.notebook;
    retirementLog = loaded.replay.map((r) => ({
      g: serialize(r.genome),
      x: r.x,
    }));
  } else {
    // Loud, not silent. A save that quietly resets is the worst possible outcome: the player
    // loses a breeding history and is told nothing, and the bug that ate it leaves no trace.
    if (loaded && !loaded.ok)
      notice = `saved garden rejected — ${loaded.error}`;
    console.error("[heirloom] could not load saved garden:", notice);
    garden = sowFounders(
      createGarden(plotXs),
      foundersFor(plotXs.length),
      SOIL,
      rand,
    );
  }
} else {
  garden = sowFounders(
    createGarden(plotXs),
    foundersFor(plotXs.length),
    SOIL,
    rand,
  );
  if (freshStart) notice = "a fresh garden";
}

/**
 * Take a shared genome from the URL fragment, if there is one.
 *
 * Untrusted input, so §10 applies: validate, and reject VISIBLY naming what failed rather
 * than substituting a default.
 *
 * Run on load AND on `hashchange`. Changing only the fragment does not reload a page, so a
 * link pasted into a tab that already has the garden open would otherwise do nothing at all —
 * silently, which is the worst version of not working. The fragment is then cleared, so a
 * later refresh does not plant the same gift seed a second time.
 */
function takeSharedGenome(): void {
  const shared = /[#&]g=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!shared) return;
  const r = parseGenome(shared[1]!);
  if (r.ok) {
    garden = addSeed(garden, r.genome);
    notice = "a shared seed was added to your tray";
    scheduleSave();
  } else {
    notice = `that shared link is not a genome — ${r.error}`;
  }
  window.history.replaceState(null, "", location.pathname + location.search);
}

window.addEventListener("hashchange", takeSharedGenome);

/**
 * The growth clock: plant ages, flowers opening, and everything derived from them.
 *
 * Advanced by ELAPSED TIME, not by frame count. It used to be `now += SPEED` once per
 * animation frame, which made a plant's growth duration a function of the renderer's speed —
 * see `src/render/motion.ts` for the measurement and why the replacement needs two rates.
 *
 * Saves and postcards store ages against this clock and its unit is unchanged, so both formats
 * round-trip exactly as before.
 */
let growthNow = 0;

/**
 * The motion clock: sway, gusts, insects, the recede animation, the plant-flash.
 *
 * Separate from `growthNow` because it runs ~5x faster. `drawScene` has taken both clocks since
 * the visit page was added — a visit pins growth and keeps motion running — and until now the
 * garden passed the same value for each. It no longer can: the two tempos are different.
 */
let motionNow = 0;

/** Timestamp of the previous frame, for the elapsed-time deltas. Null until the first frame. */
let lastFrameMs: number | null = null;

/**
 * Hiding the tab pauses the garden; showing it resumes without a jump.
 *
 * Time-based clocks keep running while a tab is backgrounded even though nothing is drawn, so
 * the first frame back would otherwise carry the entire absence and grow every plant at once.
 * Dropping the reference timestamp makes that frame advance nothing, which is what frame
 * counting did for free.
 *
 * This is here rather than in `MAX_FRAME_MS` because a duration cannot tell an unrendered tab
 * from a slow frame, and a growing bed's frames are genuinely slow — 154ms at the measured
 * 6.5fps. The browser states visibility directly; the cap is only a backstop for stalls it
 * does not cover.
 */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") lastFrameMs = null;
});

/**
 * The accumulating background. Everything ever displaced from a plot lives here as pixels.
 *
 * `composited` tracks how many of `garden.retired` have been drawn. Comparing counts each
 * frame — rather than compositing inside the pointer handler — means every path that retires
 * a plant is covered automatically, including any future one.
 */
let forest = new Forest(W, H, dpr);

/**
 * Record a retirement in the durable history, capped.
 *
 * Capped IN MEMORY, not only on save. `toSave` already sliced to the last REPLAY_CAP, so
 * everything beyond that was being kept for nothing — and `relayout` re-grows one plant per
 * entry, so an afternoon's play would have turned rotating a phone into a multi-second freeze
 * that got worse the longer you had been enjoying yourself.
 */
function logRetirement(p: {
  genome: Genome;
  plant: { segments: { x0: number }[] };
}): void {
  retirementLog.push({
    g: serialize(p.genome),
    x: p.plant.segments[0]?.x0 ?? W / 2,
  });
  if (retirementLog.length > REPLAY_CAP)
    retirementLog = retirementLog.slice(-REPLAY_CAP);
}

/**
 * Plants on their way from the bed into the background.
 *
 * They are still drawn live — and still cost a full redraw — for the length of the animation,
 * which is why the list is drained as soon as each one lands rather than kept around.
 */
let receding: {
  plant: Plant;
  key: number;
  place: Placement;
  start: number;
}[] = [];

// Rebuild the background from the replay list rather than from a stored image (§7). Genomes
// are re-expressed and re-grown, which is what lets a saved garden survive a change to the
// growth engine or the renderer — a stored bitmap would pin every past plant to the code that
// drew it. Costs one growPlant per entry, capped at BACKGROUND_REPLAY.
//
// DRAINED ACROSS FRAMES, not in one pass. As a synchronous top-level loop this ran before
// `__ready` was ever set, so it was not merely slow, it was BLOCKING: measured 152ms to
// interactive on a fresh garden against ~1.6s once a background existed — and flat between 60
// and 150 retirements, which is the cap doing exactly what it says. Every returning player paid
// that on every load, to redraw something they had already seen.
//
// Order is preserved because it is load-bearing: the forest layers by retirement order and
// `remainingContrast` keys off the count, so shuffling would change how the wash accumulates.
const restoreQueue = restored.slice();

function drainRestore(): void {
  const deadline = performance.now() + 6;
  while (restoreQueue.length > 0 && performance.now() < deadline) {
    const entry = restoreQueue.shift()!;
    forest.retire(
      grow(entry.genome, clampToBed(entry.x), SOIL).plant,
      genomeSeed(entry.genome),
    );
  }
  if (restoreQueue.length > 0) requestAnimationFrame(drainRestore);
}

if (restoreQueue.length > 0) requestAnimationFrame(drainRestore);

/** A retired plant's x may predate a narrower world; keep it on the bed. */
function clampToBed(x: number): number {
  return Math.min(W - 24, Math.max(24, x));
}

/**
 * Re-shape the world when the viewport changes enough to matter.
 *
 * A phone rotated to landscape is a different garden, not the same garden scaled: it has room
 * for more plots. `layoutChanged` gates this because the work is real — one `growPlant` per
 * occupant plus a full rebuild of the background buffer — and most resize events (dragging a
 * window edge on a desktop) land on the same world.
 *
 * Plants keep their genome and their age; only their origin moves. Growth is deterministic
 * from the genome, so re-growing at a new x gives the identical plant translated, not a
 * different one — which is the whole reason the growth seed excludes the plot.
 */
function relayout(): void {
  const next = computeLayout(window.innerWidth, window.innerHeight);
  const current: Layout = { W, H, soil: SOIL, plotXs };
  if (!layoutChanged(current, next)) {
    fitCanvas(); // the world is the same; the box may still need re-fitting
    return;
  }

  ({ W, H, soil: SOIL, plotXs } = next);
  applyCanvasSize();

  // Occupants are re-seated in order. If the new bed has fewer plots, the surplus RETIRES
  // rather than vanishing — which is what retirement already means here, and leaves the
  // plants in the background instead of deleting them.
  const occupants = garden.plots
    .map((p) => p.occupant)
    .filter((o): o is NonNullable<typeof o> => o !== null);
  const keep = occupants.slice(0, plotXs.length);
  // Surplus plants are RE-GROWN into the new world before retiring, not moved across as-is.
  // Their geometry was built around a plot that no longer exists: a plant grown at x=728 in a
  // landscape world composites almost entirely off the edge of a 396-wide portrait one, and
  // the background came back with 157 covered pixels for two whole plants.
  const surplus = occupants.slice(plotXs.length).map((o) => ({
    ...grow(o.genome, clampToBed(o.plant.segments[0]?.x0 ?? W / 2), SOIL),
    plantedAt: o.plantedAt,
  }));

  garden = {
    ...garden,
    plots: plotXs.map((x, i) => {
      const o = keep[i];
      return {
        x,
        occupant: o
          ? { ...grow(o.genome, x, SOIL), plantedAt: o.plantedAt }
          : null,
      };
    }),
    retired: [...garden.retired, ...surplus],
    retiredTotal: garden.retiredTotal + surplus.length,
  };

  // The buffer is the wrong size now. Rebuild it from the durable log.
  forest = new Forest(W, H, dpr);
  for (const entry of retirementLog) {
    const g = parseGenome(entry.g);
    if (!g.ok) continue; // a corrupt log entry must not take the whole background down
    forest.retire(
      grow(g.genome, clampToBed(entry.x), SOIL).plant,
      genomeSeed(g.genome),
    );
  }

  // Surplus plants are composited IMMEDIATELY rather than being left to the recede animation.
  //
  // A recede is the answer to the player replacing a plant — it shows where the old one went.
  // A rotation is not that: the world got narrower and some plants no longer have a plot. There
  // is nothing to show the player about it, and easing them back would leave the background
  // measurably empty for the length of the animation, which is what a driver caught: rotating
  // to portrait reported `coverage 0` where a rebuilt background should have had two plants
  // in it.
  for (const s of surplus) {
    forest.retire(s.plant, genomeSeed(s.genome));
    logRetirement(s);
  }
  // Everything in the queue is now pixels; the frame loop must not process any of it again.
  garden = { ...garden, retired: [] };
  // Anything that WAS mid-recede belonged to a world that no longer exists: its reserved
  // placement was computed against the old width and the buffer it was heading for has just
  // been replaced. It is already in `retirementLog`, so the rebuild above drew it in the new
  // world at its proper place.
  receding = [];
  stageCache = null; // wrong size now
  // The bed just changed shape, so a plot index no longer means the same plant — and the
  // surplus plants that just retired may include the one whose card is open. Closing is the
  // honest response; repositioning would leave a card describing a plant that is now in the
  // background.
  closeCard();
  scheduleSave();
}

window.addEventListener("resize", relayout);
window.addEventListener("orientationchange", relayout);

/**
 * Persist on a debounce — with a ceiling.
 *
 * Every verb mutates the garden, and serializing the whole thing on each one would run on the
 * same frame as a drag, so a burst of clicks collapses into one write 700ms after the last.
 *
 * The ceiling is not a refinement; without it the feature does not work. A trailing debounce
 * with no maximum wait never fires while the player keeps playing, because every action resets
 * it. A soak run of 150 rounds at roughly 420ms each wrote **nothing at all** for the entire
 * run — the save appeared only once the driver stopped — so an engaged player who closed the
 * tab would have lost the lot. Found by watching the saved bytes across a long session; no
 * single-action test could have shown it, because the bug is that the NEXT action arrives.
 */
const SAVE_DEBOUNCE_MS = 700;
const SAVE_MAX_WAIT_MS = 5000;

let saveTimer = 0;
let savePendingSince = 0;

/** Set when the garden is being deliberately discarded; nothing may write after that. */
let suppressSave = false;

function writeSave(): void {
  if (suppressSave) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  savePendingSince = 0;
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify(toSave(garden, growthNow, retirementLog, notebook)),
    );
  } catch (e) {
    // Quota exceeded, private mode, disabled storage. Say so — a garden that silently stops
    // saving looks exactly like one that is saving fine until the tab closes.
    notice = `could not save: ${(e as Error).message}`;
    console.error("[heirloom] save failed:", e);
  }
}

function scheduleSave(): void {
  if (!savePendingSince) savePendingSince = Date.now();
  if (Date.now() - savePendingSince >= SAVE_MAX_WAIT_MS) {
    writeSave();
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(writeSave, SAVE_DEBOUNCE_MS);
}

// A tab can be closed or backgrounded between debounce and write. `visibilitychange` is the
// event that actually fires on mobile — `beforeunload` does not, reliably, when an app is
// swiped away.
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && savePendingSince) writeSave();
});
window.addEventListener("pagehide", () => {
  if (savePendingSince) writeSave();
});

// Called HERE, not at the point of definition: takeSharedGenome may schedule a save, and
// `saveTimer` above is a `let` — invoking it any earlier would hit the temporal dead zone.
takeSharedGenome();

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
  | { kind: "pollen"; bug: Insect; from: Vec2 }
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

/**
 * Long-press to read a plant.
 *
 * The first attempt was "click the plant anywhere that is not a flower", which works on a
 * sparse plant and fails completely on the plants this game is now capable of growing: a
 * bushy raceme carries sixty-eight flowers, and between them there is almost no bare stem
 * left to aim at. The driver found it immediately — every attempt to open a card landed on a
 * bloom and took a seed instead.
 *
 * A press-and-hold consumes no gesture the game already uses (a click is CLONE, a drag is
 * CROSS or PLANT), needs no on-screen control against a deliberately bare interface, and is
 * the one inspect gesture that works identically under a finger and a mouse.
 */
const PRESS_MS = 450;
let pressTimer = 0;
let pressAt: Vec2 | null = null;
/**
 * Set when a hold has already acted, so the pointerup that ENDS the hold does not act again.
 *
 * Without it the gesture cancels itself: the timer opens the card, the finger lifts, and the
 * click path sees no drag in progress, treats the lift as a tap on the plant, and toggles the
 * card straight back off. The card appeared and vanished within one gesture, which reads as
 * the feature simply not working.
 */
let pressFired = false;

function cancelPress(): void {
  clearTimeout(pressTimer);
  pressAt = null;
}

canvas.addEventListener("pointerdown", (e) => {
  usingKeys = false;
  const p = toCanvas(e);
  pointer = p;
  canvas.setPointerCapture(e.pointerId);

  pressAt = p;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    const on = plantAt(p);
    if (on === null || !garden.plots[on]?.occupant) return;
    // Cancel whatever the press had picked up. Without this the pointerup that ends the hold
    // would still fire CLONE, so reading a plant would quietly also take a seed from it.
    drag = null;
    pressAt = null;
    inspecting = on;
    pressFired = true;
    learn("read");
    renderCard();
  }, PRESS_MS);

  // BEFORE the bloom test. A carrier sits ON a flower, so testing blooms first would always
  // pick the flower underneath it and the carrier would be impossible to pick up — a failure
  // that presents as "dragging the insect clones the plant".
  const carrier = insectAt(p);
  if (carrier) {
    drag = { kind: "pollen", bug: carrier, from: p };
    return;
  }

  const seed = seedAt(garden, p, W, H);
  if (seed !== null) {
    drag = { kind: "seed", id: seed, from: p };
    return;
  }
  const hit = bloomAt(garden, p, growthNow, 1.15, localToPlot);
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
  // Moving turns a hold into a drag. Without a slop threshold the tiny jitter of a finger
  // resting on glass cancels every long press before it can fire.
  if (
    pressAt &&
    Math.hypot(pointer.x - pressAt.x, pointer.y - pressAt.y) > CLICK_SLOP
  )
    cancelPress();
});

canvas.addEventListener("pointerup", (e) => {
  cancelPress();
  release(e);
  // One call covering every branch, rather than one per verb. The handler has four early
  // returns, and a per-branch save is exactly the shape where the fifth branch added later
  // forgets to persist and the loss only shows up on the next reload.
  scheduleSave();
});

/**
 * What the mirror last reflected.
 *
 * Cheap enough to compute every frame, which is the point: the alternative is a `syncA11y()`
 * call at every site that mutates the garden, and that is the shape where the branch added next
 * year forgets one. The labels are a function of occupancy and whether each plant has finished,
 * so this signature changes exactly when a label would. It also catches `__seek`, which moves
 * the clock without going through any verb at all.
 */
let a11ySig = "";

/** Push the garden's current state into the hidden mirror, if any of it has changed. */
function syncA11y(): void {
  const carrying = insects().filter((i) => i.pollen);
  const sig =
    `${garden.tray.length}|${carrying.length}|` +
    garden.plots
      .map((p) =>
        !p.occupant ? "-" : isGrown(p.occupant, growthNow) ? "g" : "w",
      )
      .join("");
  if (sig === a11ySig) return;
  a11ySig = sig;
  syncMirror(
    garden.plots.map((p, i) => plotLabel(i, p.occupant, growthNow)),
    garden.tray.map((_, i) => seedLabel(i, garden.tray.length)),
    carrying.map((c) => carrierLabel(c.pollen!)),
  );
}

/**
 * The five verbs, each one applied.
 *
 * Split out of `release()` because the keyboard has to fire the same verbs, and the version of
 * this that lived inside the pointer handler could only be reached by inferring a verb from
 * geometry. Two input paths separately deciding "which genome crosses with which" is a second
 * hand-maintained copy of one truth — the mechanism that has already cost this project the
 * enumerated CI driver list, the drive-persist coverage floor, and a README test count.
 *
 * `release()` keeps the geometry that decides WHICH verb a gesture meant. These decide what each
 * verb DOES. `at` is only where the confirmation ring is drawn, so the keyboard can pass a plot's
 * own position and get the same feedback without a pointer.
 */
function doCross(
  a: Genome,
  b: Genome,
  at: Vec2,
  origin: Origin = "cross",
): void {
  garden = addSeed(garden, crossOf(a, b, rand), {
    parents: [serialize(a), serialize(b)],
    origin,
  });
  learn("cross");
  flash = { at, until: motionNow + FLASH_TICKS };
}

function doSelf(g: Genome, at: Vec2): void {
  garden = addSeed(garden, crossOf(g, g, rand), {
    parents: [serialize(g), serialize(g)],
    origin: "self",
  });
  learn("self");
  flash = { at, until: motionNow + FLASH_TICKS };
}

function doClone(g: Genome, at: Vec2): void {
  garden = addSeed(garden, cloneOf(g, rand), {
    parents: [serialize(g), serialize(g)],
    origin: "clone",
  });
  learn("clone");
  flash = { at, until: motionNow + FLASH_TICKS };
}

function doSplice(aId: number, bId: number, at: Vec2): void {
  garden = spliceSeeds(garden, aId, bId, rand);
  flash = { at, until: motionNow + FLASH_TICKS };
}

function doPlant(seedId: number, plotIndex: number): void {
  garden = plantSeed(garden, seedId, plotIndex, SOIL, growthNow);
  learn("plant");
  flash = {
    at: { x: plotXs[plotIndex]!, y: SOIL },
    until: motionNow + FLASH_TICKS,
  };
}

/**
 * What the keyboard is holding — the keyboard's analogue of `drag`.
 *
 * Deliberately NOT shared with `drag`. `drag` carries a canvas origin point, used to tell a
 * click from a drag and so to tell CLONE from SELF. A key has no travel, so folding the two
 * together would mean inventing an origin nobody measured and then reading a distance from it.
 */
let held: Target | null = null;

/**
 * Which input the player last used.
 *
 * The HUD teaches each verb until the player has performed it once, and it teaches GESTURES.
 * Which gesture to name is not knowable from the verb alone.
 */
let usingKeys = false;

/**
 * Pick up, or put down on.
 *
 * Driven by `click`, not by a key. These are real buttons, so Enter and Space already produce a
 * click and assistive technology can activate one with no key pressed at all — routing through
 * activation rather than through a keystroke is what makes the mirror work for the people it
 * exists for, and it gets Space for free.
 */
function activate(t: Target): void {
  usingKeys = true;
  const occ =
    t.kind === "plot" ? (garden.plots[t.index]?.occupant ?? null) : null;
  const at = { x: plotXs[t.index] ?? W / 2, y: SOIL };

  if (!held) {
    // An empty plot holds nothing, so picking it up would arm a verb with no subject. A carrier
    // always holds something, so it needs no such check.
    if (t.kind === "plot" && !occ) return;
    held = t;
    announce(
      t.kind === "plot"
        ? "picked up a flower"
        : t.kind === "seed"
          ? "picked up a seed"
          : "took the pollinator's pollen",
    );
    return;
  }

  const from = held;
  held = null;

  if (from.kind === "plot" && t.kind === "plot") {
    const a = garden.plots[from.index]?.occupant;
    // The plant that was picked up can have been replaced in the meantime — by a planting, or
    // by a restore from the drawer. Holding a plot index is not holding a plant.
    if (!a) return;
    if (t.index === from.index) {
      doSelf(a.genome, at);
      announce("selfed");
    } else if (occ) {
      doCross(a.genome, occ.genome, at);
      announce("crossed");
    } else return;
  } else if (from.kind === "seed" && t.kind === "plot") {
    const seed = garden.tray[from.index];
    if (!seed) return;
    doPlant(seed.id, t.index);
    announce("planted");
  } else if (from.kind === "seed" && t.kind === "seed") {
    const a = garden.tray[from.index];
    const b = garden.tray[t.index];
    if (!a || !b || a.id === b.id) return;
    doSplice(a.id, b.id, at);
    announce("spliced");
  } else if (from.kind === "carrier" && t.kind === "plot") {
    // Indexed against the same filtered list `syncA11y` built the labels from, so the button's
    // index and the insect it names cannot disagree.
    const bug = insects().filter((i) => i.pollen)[from.index];
    if (!bug || !occ) return;
    const pollen = parseGenome(bug.pollen!);
    if (!pollen.ok) return;
    doCross(pollen.genome, occ.genome, at, "wild");
    removeInsect(bug);
    announce("crossed in the pollen");
  } else return;

  afterVerb();
}

/**
 * A carrier has left. Did it pollinate on the way out?
 *
 * The parent is the flower it was ACTUALLY SITTING ON, never a random one. The player watched it
 * settle there, so the surprise stays honest rather than arbitrary — and a seed whose parentage
 * the player could not have predicted from what they saw would be evidence they cannot reason
 * about.
 *
 * If that plant has since been replaced the cross is abandoned. Evidence about a plant that is
 * no longer inspectable is evidence the player cannot act on.
 */
function resolveDeparture(bug: Insect, pollinated: boolean): void {
  if (!pollinated || !bug.pollen) return;
  const occ = garden.plots[bug.plotIndex]?.occupant;
  if (!occ) return;
  const pollen = parseGenome(bug.pollen);
  if (!pollen.ok) return;
  doCross(pollen.genome, occ.genome, { x: bug.x, y: bug.y }, "wild");
  announce("a pollinator pollinated a flower before it left");
  afterVerb();
}

/** Everything a verb has to do afterwards, in one place, so the next verb cannot forget one. */
function afterVerb(): void {
  // A full tray does not refuse — it DISCARDS, silently, dropping the OLDEST seed
  // (`src/game/garden.ts:150`). That is worth saying out loud: a player who has just bred
  // something and been handed nothing has no way to tell that from the verb having failed.
  // Said after the verb's own announcement, deliberately, because losing a seed outranks it.
  if (garden.tray.length === TRAY_CAP) {
    announce("the tray is full — the oldest seed was lost");
  }
  syncA11y();
  scheduleSave();
}

/**
 * Plants whose completion has already been announced.
 *
 * Keyed on the `Planting` object rather than on a plot index or a seed id, matching the
 * `WeakMap`-on-`Plant` pattern `src/game/hit.ts` uses for the memoised cull. A plot index would
 * re-announce on every replacement in that plot; a seed id does not exist for a founder.
 */
const announcedGrown = new WeakSet<Planting>();

/**
 * Announce the one thing that happens without the player doing anything.
 *
 * Shares `isGrown` with `recordGrownPlants()` and nothing else. The notebook files evidence only
 * for plants carrying a seed id and parents; this announces ANY plant finishing, founders
 * included. Same predicate, different question — which is exactly why the predicate is imported
 * rather than either of them re-deriving "has it finished".
 */
function announceGrown(): void {
  for (let i = 0; i < garden.plots.length; i++) {
    const p = garden.plots[i]?.occupant;
    if (!p || announcedGrown.has(p) || !isGrown(p, growthNow)) continue;
    announcedGrown.add(p);
    announce(grownLine(i, p, growthNow));
  }
}

/**
 * The keys that are not activation.
 *
 * CLONE and READ need their own keys because the pointer distinguishes them by geometry and the
 * keyboard cannot: a click on a bloom that never became a drag is a clone, and a click anywhere
 * else on the plant opens its card. Focus lands on a plant, not on a pixel, so what the pointer
 * infers has to be named.
 */
window.addEventListener("keydown", (e) => {
  if (focusedTarget()) usingKeys = true;
  if (e.key === "Escape") {
    if (held) {
      held = null;
      announce("put it back");
      e.preventDefault();
    }
    return;
  }

  const t = focusedTarget();
  if (!t || t.kind !== "plot") return;
  const occ = garden.plots[t.index]?.occupant;
  if (!occ) return;

  if (e.key === "c" || e.key === "C") {
    doClone(occ.genome, { x: plotXs[t.index] ?? W / 2, y: SOIL });
    announce("cloned");
    afterVerb();
    e.preventDefault();
  } else if (e.key === "r" || e.key === "R") {
    inspecting = t.index;
    learn("read");
    renderCard();
    e.preventDefault();
  }
});

mountMirror(activate);

function release(e: PointerEvent): void {
  const p = toCanvas(e);
  const d = drag;
  drag = null;
  // A hold already acted on this gesture; the lift that ends it must not act again.
  if (pressFired) {
    pressFired = false;
    return;
  }
  if (!d) {
    // Nothing was picked up, so this was a click on the scene itself. On a plant it opens that
    // plant's card; anywhere else it closes whatever is open — which is the behaviour a panel
    // over a game board has to have, or it becomes something you must aim at a small ✕ to
    // dismiss.
    const on = plantAt(p);
    if (on !== null && garden.plots[on]?.occupant) {
      inspecting = inspecting === on ? null : on;
      renderCard();
    } else {
      closeCard();
      closeDrawer();
    }
    return;
  }
  const travelled = Math.hypot(p.x - d.from.x, p.y - d.from.y);

  if (d.kind === "pollen") {
    // WILD — pollen from a plant the player retired, crossed into a flower they chose.
    //
    // No partner, no cross, and the carrier stays put: a fumbled drag should cost nothing,
    // because the carrier is on a timer the player did not set.
    const onto = bloomAt(garden, p, growthNow, 1.15, localToPlot);
    if (!onto) return;
    const partner = garden.plots[onto.plotIndex]!.occupant!.genome;
    const pollen = parseGenome(d.bug.pollen!);
    if (!pollen.ok) return;
    doCross(pollen.genome, partner, p, "wild");
    removeInsect(d.bug);
    afterVerb();
    return;
  }

  if (d.kind === "bloom") {
    const onto = bloomAt(garden, p, growthNow, 1.15, localToPlot);
    if (onto && onto.plotIndex !== d.plotIndex) {
      // CROSS — two different plants.
      doCross(d.genome, garden.plots[onto.plotIndex]!.occupant!.genome, p);
    } else if (onto && travelled >= CLICK_SLOP) {
      // SELF — a drag from one flower to ANOTHER FLOWER ON THE SAME PLANT.
      //
      // This used to do nothing, and its absence was a hole in the design rather than a
      // missing convenience. Selfing is the classic test for a hidden recessive: a carrier
      // crossed with itself throws the recessive in a quarter of its seedlings, and no other
      // cross the player can perform reveals what a plant is carrying with anything like that
      // reliability. Without it the albinism locus was a fact about the world with no
      // instrument for investigating it.
      //
      // Distinguished from CLONE by travel alone, which is why the clone branch has to test
      // distance rather than simply catching everything that is not a cross.
      doSelf(d.genome, p);
    } else if (travelled < CLICK_SLOP) {
      // CLONE — a click that never became a drag. A clone is genetically its parent, so it
      // can never reveal a carrier; that is exactly why selfing had to exist.
      doClone(d.genome, p);
    }
    return;
  }

  // A seed was dragged. Onto another seed it splices; onto the bed it plants.
  const onto = seedAt(garden, p, W, H);
  if (onto !== null && onto !== d.id) {
    doSplice(d.id, onto, p);
    return;
  }
  const plot = plotAt(garden, p);
  // Only a drop above the tray line plants: dragging a seed sideways along the tray is
  // rearranging, not planting, and every x in the bed is within some plot's reach.
  if (plot !== null && p.y < SOIL + 24) doPlant(d.id, plot);
}

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

/**
 * The plot whose plant is under a point, or null.
 *
 * Its own hit test rather than reusing `plotAt`, which answers a different question: `plotAt`
 * finds the plot a dragged SEED should land in, so it deliberately covers the whole bed
 * including bare ground. Opening a card wants the opposite — a click has to be ON a plant, or
 * every tap on empty sky would pop a panel over the garden.
 *
 * Blooms are tested first by the caller, so this only ever sees clicks on stems and foliage.
 */
/**
 * The pollen carrier under a point, or null.
 *
 * Ambient insects are skipped — they carry nothing, so there is nothing to pick up, and making
 * them draggable would offer the player a gesture that silently does nothing.
 */
function insectAt(p: Vec2): Insect | null {
  for (const i of insects()) {
    if (!i.pollen) continue;
    if (Math.hypot(p.x - i.x, p.y - i.y) <= 12) return i;
  }
  return null;
}

/** How many flowers are open anywhere in the bed — a carrier needs somewhere to land. */
function bloomCount(): number {
  return garden.plots.reduce(
    (n, p) => n + (p.occupant ? bloomsOf(p.occupant, growthNow).length : 0),
    0,
  );
}

/**
 * A drawn bloom for a carrier to settle on, in CANVAS space, or null when nothing is open.
 *
 * Canvas space and not plant space, deliberately: plants are painted through a depth transform,
 * so a bloom's position in its own plant's coordinates is not where it appears. An insect placed
 * at the untransformed point would sit visibly away from the flower it is supposed to be on —
 * the same trap `__blooms` documents for drivers aiming a pointer.
 */
function anyOpenBloom(): { plotIndex: number; x: number; y: number } | null {
  const all = garden.plots.flatMap((plot, plotIndex) => {
    const occ = plot.occupant;
    if (!occ) return [];
    const base = occ.plant.segments[0];
    const anchor = { x: base?.x0 ?? 0, y: base?.y0 ?? 0 };
    const d = bedDepth(plotIndex);
    return bloomsOf(occ, growthNow).map((b) => {
      const at = toCanvasSpace(b.center, anchor, d);
      return { plotIndex, x: at.x, y: at.y };
    });
  });
  if (!all.length) return null;
  return all[Math.floor(rand() * all.length)] ?? null;
}

function plantAt(p: Vec2): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const [i, plot] of garden.plots.entries()) {
    const occ = plot.occupant;
    if (!occ) continue;
    const age = growthNow - occ.plantedAt;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of occ.plant.segments) {
      if (s.tick > age) continue;
      minX = Math.min(minX, s.x0, s.x1);
      maxX = Math.max(maxX, s.x0, s.x1);
      minY = Math.min(minY, s.y0, s.y1);
      maxY = Math.max(maxY, s.y0, s.y1);
    }
    // FLOWERS COUNT AS PART OF THE PLANT. Measuring the stems alone left every bloom on a
    // long pedicel — and an umbel's whole plate — outside the box, so whether a press-and-hold
    // opened the card depended on which flower you happened to hold. It worked on a stem, did
    // nothing on a flower at the canopy edge, and the difference was invisible to the player.
    for (const b of occ.plant.blooms) {
      if (b.tick > age) continue;
      minX = Math.min(minX, b.center.x - b.radius);
      maxX = Math.max(maxX, b.center.x + b.radius);
      minY = Math.min(minY, b.center.y - b.radius);
      maxY = Math.max(maxY, b.center.y + b.radius);
    }
    if (minX === Infinity) continue;
    // Padding, because a stem is a few pixels wide and the bounding box of a sparse plant is
    // mostly air. This is a forgiving target on purpose: it is an inspect gesture, not a
    // precision one.
    const pad = 26;
    if (p.x < minX - pad || p.x > maxX + pad) continue;
    if (p.y < minY - pad || p.y > maxY + pad) continue;
    // Canopies overlap. Nearest centre, so a click in the overlap goes to the plant it is
    // actually closest to rather than to whichever plot came first in the array.
    const d = Math.abs(p.x - (minX + maxX) / 2);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The plot whose card is open, or null. */
let inspecting: number | null = null;

const cardEl = document.getElementById("card")!;

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/**
 * Draw the card for a plot, or hide it.
 *
 * Everything here comes from the NOTEBOOK, never from the genome directly, and that is the
 * whole point of the feature. The genome is one function call away and printing it would be
 * easier than any of this — and it would delete the carrier mechanic, because a carrier is
 * defined by being indistinguishable until you breed it.
 */
function renderCard(): void {
  const plot = inspecting === null ? null : garden.plots[inspecting];
  const occ = plot?.occupant;
  if (!occ || !isGrown(occ, growthNow)) {
    // An unfinished plant shows nothing. §4: traits are not disclosed before bloom, and a card
    // that reported them mid-growth would be a way to read the flower before it opened.
    cardEl.hidden = true;
    return;
  }

  const code = serialize(occ.genome);
  const carried = carriedBy(notebook, code);
  const grown = offspringCount(notebook, code);

  const traits = describeTraits(code)
    .map((t) => `<li>${esc(t)}</li>`)
    .join("");

  const carries = carried.length
    ? `<div class="carries"><ul>${carried
        .map((c) => `<li>${esc(describeCarried(c))}</li>`)
        .join("")}</ul></div>`
    : `<div class="nothing">${
        grown === 0
          ? "nothing known beyond what it shows. Cross it — or self it — and grow the seedlings."
          : `nothing hidden found yet, from ${grown} seedling${grown === 1 ? "" : "s"} grown.`
      }</div>`;

  const from =
    occ.parents && occ.origin && occ.origin !== "founder"
      ? `<div class="from">${esc(originLine(occ.origin, occ.parents))}</div>`
      : `<div class="from">one of the garden's founders</div>`;

  cardEl.innerHTML =
    `<button type="button" aria-label="close">✕</button>` +
    `<h2>${esc(shortLabel(code))}</h2><ul>${traits}</ul>${carries}${from}`;
  cardEl.hidden = false;
  positionCard(occ.plant.segments[0]?.x0 ?? W / 2);
}

/** How this plant came to be, in the voice of the rest of the card. */
function originLine(origin: string, parents: [string, string]): string {
  const a = shortLabel(parents[0]);
  const b = shortLabel(parents[1]);
  if (origin === "self") return `self-crossed from a ${a}`;
  // Named as what it is. A clone is genetically its parent, so it can never turn up an allele
  // the parent was not already carrying — worth saying, because it is the reason clicking a
  // flower over and over never answers anything.
  if (origin === "clone")
    return `a cutting of a ${a} — same plant, no new evidence`;
  return `from a ${a} × ${b} cross`;
}

/** Put the card beside its plant, and never off the edge of the window. */
function positionCard(worldX: number): void {
  const box = canvas.getBoundingClientRect();
  const x = box.left + (worldX / W) * box.width;
  const w = cardEl.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  cardEl.style.left = `${Math.round(left)}px`;
  const top = box.top + 10;
  cardEl.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - cardEl.offsetHeight - 8, top)))}px`;
}

function closeCard(): void {
  inspecting = null;
  cardEl.hidden = true;
}

/* ── The drawer ─────────────────────────────────────────────────────────────────────────── */

const drawerEl = document.getElementById("drawer")!;
const drawerTabEl = document.getElementById("drawer-tab")!;
let drawerOpen = false;

/**
 * List every plant that has been retired, newest first.
 *
 * Newest first because the plant you just displaced is the one you are most likely to want
 * back — the drawer exists because replacing a plant used to be irreversible.
 *
 * The list is `retirementLog`, which was already being kept and already being saved; §7 built
 * it to regenerate the background. Nothing new is stored to make this work.
 */
/**
 * Thumbnails waiting to be painted, drained a few per frame.
 *
 * Painting them all in the IntersectionObserver callback stalled for 1.0-1.7s, measured: a
 * full-width 46vh grid has ~33 cells visible at once, and each one GROWS a plant. "Lazy" bought
 * a bound on the total, not on the size of any single stall.
 */
const thumbQueue: HTMLElement[] = [];
let pumping = false;
let drawerIO: IntersectionObserver | null = null;

/**
 * This garden as a postcard, for the share link.
 *
 * `retirementLog` rather than `garden.retired`: a restored garden's `retired` is empty (see the
 * comment on `retirementLog` above) because retired plants are composited into the background
 * buffer, not kept as objects. Building the forest from `garden.retired` would silently ship an
 * empty forest to anyone who shares after a reload.
 *
 * The forest is sent `slice(-BACKGROUND_REPLAY)` — newest entries, oldest trimmed — because
 * those are the layers that actually render (see `remainingContrast`), and order within them is
 * load-bearing: the forest layers by retirement order.
 */
function gardenPostcard(): string {
  return packPostcard({
    W,
    H,
    plotCount: garden.plots.length,
    plots: garden.plots.map((p) =>
      p.occupant
        ? {
            genome: p.occupant.genome,
            // `sharedAge`, not a clamp written out here. This line used to cap the age at
            // `maxTick` on the premise that "past maxTick nothing about the plant changes",
            // and that premise is false: blooms are created AT tip termination and take
            // OPEN_TICKS more to open, so a garden shared in full flower arrived with its
            // terminal flowers 32% open and stayed that way. The rule has one home now.
            age: sharedAge(
              growthNow - p.occupant.plantedAt,
              p.occupant.maxTick,
            ),
          }
        : null,
    ),
    forest: retirementLog.slice(-BACKGROUND_REPLAY).flatMap((e) => {
      const parsed = parseGenome(e.g);
      // Skip rather than throw: a single corrupted history entry should not make the whole
      // garden unshareable.
      return parsed.ok ? [{ genome: parsed.genome, x: e.x }] : [];
    }),
  });
}

function pumpThumbs(): void {
  const deadline = performance.now() + 6; // leave most of a 16.7ms frame for the garden
  while (thumbQueue.length > 0 && performance.now() < deadline) {
    const fig = thumbQueue.shift()!;
    if (!fig.isConnected) continue;
    const canvas = fig.querySelector("canvas");
    const code = fig.dataset["code"];
    if (canvas && code) paintThumb(canvas, code);
  }
  if (thumbQueue.length > 0) requestAnimationFrame(pumpThumbs);
  else pumping = false;
}

/**
 * The head-of-drawer share line, in BOTH the empty and populated branches of `renderDrawer`.
 *
 * A brand-new garden with no retirement history is still shareable — a bare bed is a legitimate
 * thing to send — so this cannot live only in the branch that has entries to show.
 */
const shareRow = `<button id="share-garden" type="button">copy a link to this garden</button>`;

/** Wire the share button after each `renderDrawer` innerHTML assignment re-creates it. */
function wireShareButton(): void {
  drawerEl.querySelector("#share-garden")?.addEventListener("click", () => {
    // `visitPath` THROWS when it cannot rewrite the path, and that is the point. This used to
    // be `location.pathname.replace(/garden\/$/, "visit/")` inline, which misses the
    // `…/garden/index.html` form GitHub Pages also serves and returns its input unchanged when
    // it does. The link then kept the garden path, `#garden=` matched nothing there, and the
    // recipient opened it to their OWN garden with nothing anywhere saying so.
    let url: string;
    try {
      url = `${location.origin}${visitPath(location.pathname)}#garden=${gardenPostcard()}`;
    } catch (e) {
      notice = `could not make a link to this garden — ${(e as Error).message}`;
      announce(notice);
      return;
    }
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        notice = "link copied — it opens this garden for anyone who follows it";
        announce(notice);
        setTimeout(() => {
          notice = "";
        }, 3200);
      })
      .catch((e: Error) => {
        // Clipboard access is permission-gated and fails in plenty of contexts, so the fallback
        // is the only way the player gets their link. It is NOT the tray's fallback, which folds
        // the URL into `notice`: `#hint` is one line, `nowrap`, `overflow: hidden`,
        // `text-overflow: ellipsis`. The tray's payload is 14 characters and survives that; a
        // garden link is around a thousand and arrives as an ellipsis. The player was shown a
        // truncated URL and had no way to recover the rest of it.
        notice = `could not copy (${e.message}) — the link is in the drawer; select it and copy it by hand`;
        announce(notice);
        showShareFallback(url);
      });
  });
}

/**
 * The link itself, in something the player can select.
 *
 * A textarea rather than a `<p>`: it wraps, it scrolls, and a triple-click or ctrl-A inside it
 * selects exactly the URL and nothing else. Read-only rather than disabled — a disabled field
 * is not selectable and is skipped by keyboard navigation, which would leave a keyboard-only
 * player exactly where the ellipsis did.
 *
 * Focused and pre-selected, so for most players "copy by hand" is one keystroke.
 *
 * Lives in the drawer, next to the button that produced it. `renderDrawer` rewrites the drawer
 * wholesale on open and close, which clears this — correct, because a stale link to a garden
 * that has since changed is worse than no link.
 */
function showShareFallback(url: string): void {
  drawerEl.querySelector("#share-fallback")?.remove();
  const box = document.createElement("div");
  box.id = "share-fallback";
  const label = document.createElement("label");
  label.htmlFor = "share-fallback-url";
  label.textContent = "the clipboard refused — copy this link by hand:";
  const field = document.createElement("textarea");
  field.id = "share-fallback-url";
  field.readOnly = true;
  field.rows = 3;
  field.spellcheck = false;
  field.value = url;
  box.append(label, field);
  const button = drawerEl.querySelector("#share-garden");
  if (button) button.after(box);
  else drawerEl.prepend(box);
  field.focus();
  field.select();
}

function renderDrawer(): void {
  drawerTabEl.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
  // Always start from nothing: a stale observer would keep watching detached figures, and a
  // stale queue would paint into canvases that are no longer on the page.
  drawerIO?.disconnect();
  drawerIO = null;
  thumbQueue.length = 0;
  if (!drawerOpen) {
    drawerEl.hidden = true;
    // RELEASE the panel. Its canvases are 192x168 each, and their backing store does not live
    // in the JS heap — 120 entries measured as ~15MB still held after closing, climbing with
    // every session and never coming back. `hidden` stops it being drawn, not being allocated.
    drawerEl.innerHTML = "";
    return;
  }
  drawerEl.hidden = false;
  if (retirementLog.length === 0) {
    drawerEl.innerHTML =
      shareRow +
      '<p class="empty">nothing retired yet — plant over a flower and it will keep here</p>';
    wireShareButton();
    return;
  }
  drawerEl.innerHTML =
    shareRow +
    retirementLog
      .map(
        (e) =>
          `<figure data-code="${esc(e.g)}" tabindex="0">` +
          `<canvas width="192" height="168"></canvas>` +
          `<figcaption>${esc(shortLabel(e.g))}</figcaption></figure>`,
      )
      .reverse()
      .join("");
  wireShareButton();

  // Painted LAZILY, and once each. Growing and painting 200 plants the moment the drawer opens
  // would stall the frame; growing the eight actually on screen does not. Each figure is
  // unobserved as soon as it paints, so scrolling back over it costs nothing.
  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const fig = entry.target as HTMLElement;
        // QUEUED, not painted here. Growing ~33 plants inside one callback is a single long
        // frame, and a one-second freeze on opening a panel reads as the whole game being slow.
        thumbQueue.push(fig);
        obs.unobserve(fig);
      }
      if (!pumping && thumbQueue.length > 0) {
        pumping = true;
        requestAnimationFrame(pumpThumbs);
      }
    },
    { root: drawerEl },
  );
  drawerIO = io;
  drawerEl.querySelectorAll("figure").forEach((f) => {
    io.observe(f);
    f.addEventListener("click", () =>
      restoreFromDrawer((f as HTMLElement).dataset["code"]),
    );
    // Reachable without a pointer, since the figures are already focusable. The garden itself
    // still is not, but a panel that IS keyboard-navigable should not throw that away.
    f.addEventListener("keydown", (ev) => {
      const key = (ev as KeyboardEvent).key;
      if (key !== "Enter" && key !== " ") return;
      ev.preventDefault();
      restoreFromDrawer((f as HTMLElement).dataset["code"]);
    });
  });
}

/**
 * Put a copy of an archived plant back in the tray.
 *
 * A COPY: the entry stays in the drawer. A drawer that emptied as it was used would recreate
 * the loss it exists to remove.
 *
 * No parents, deliberately, and that is not an omission. A restored plant is an observation the
 * player already made, not a new one — see `Origin`. The notebook files a cross only for a
 * planting that HAS parents, so restoring the same flower five times cannot manufacture five
 * independent proofs that its parent carries a recessive.
 */
function restoreFromDrawer(code: string | undefined): boolean {
  if (!code) return false;
  const parsed = parseGenome(code);
  if (!parsed.ok) {
    // Loud, per §10 and the shared-link path this mirrors: name what failed. A silent return
    // would read as a dead click.
    notice = `that drawer entry is unreadable — ${parsed.error}`;
    return false;
  }
  garden = addSeed(garden, parsed.genome, { origin: "archive" });
  notice = "a plant was taken back out of the drawer";
  closeDrawer();
  scheduleSave();
  return true;
}

function openDrawer(): void {
  drawerOpen = true;
  // Two panels over one small garden is one too many.
  closeCard();
  renderDrawer();
}

function closeDrawer(): void {
  drawerOpen = false;
  renderDrawer();
}

drawerTabEl.addEventListener("click", () => {
  if (drawerOpen) closeDrawer();
  else openDrawer();
});

cardEl.addEventListener("pointerdown", (e) => {
  // Only the close button acts; clicks on the text must not fall through to the canvas.
  e.stopPropagation();
  if ((e.target as HTMLElement).tagName === "BUTTON") closeCard();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCard();
});

/**
 * File an observation for every plant that has finished growing.
 *
 * The timing is the design, not an implementation detail. A cross is recorded when its child
 * has GROWN — not when the seed was made — because the evidence is the seedling, and a
 * notebook that filed the entry at cross time would let the player deduce a parent's hidden
 * alleles from a seed they never planted. That is the same disclosure §4 forbids, arriving by
 * a longer route, and it would also remove the reason to plant anything.
 *
 * An albino counts. It never blooms, but it finishes growing, and it is the single most
 * informative thing that can happen in this garden.
 */
function recordGrownPlants(): void {
  let filed = false;
  for (const plot of garden.plots) {
    const p = plot.occupant;
    if (!p || p.seedId === undefined || !p.parents) continue;
    if (!isGrown(p, growthNow)) continue;
    const before = notebook;
    notebook = recordCross(notebook, {
      seedId: p.seedId,
      child: serialize(p.genome),
      parents: p.parents,
    });
    if (notebook !== before) filed = true;
  }
  if (filed) {
    scheduleSave();
    // An open card is a view of the notebook, so it has to follow it. The moment a seedling
    // finishes growing is exactly the moment a deduction can appear, and a card that only
    // refreshed when reopened would hide the payoff behind a click nobody knows to make.
    if (inspecting !== null) renderCard();
  }
}

/**
 * A canvas point in a given plot's own space.
 *
 * Every hit test goes through this, because every plant is DRAWN through the matching forward
 * transform. The two must agree or the game develops a quiet offset between where a flower is
 * and where it can be touched — and the offset is largest on the plants furthest back, which
 * is exactly where nobody would think to look for it.
 */
const localToPlot = (plotIndex: number, p: Vec2): Vec2 => {
  const occ = garden.plots[plotIndex]?.occupant;
  const base = occ?.plant.segments[0];
  if (!base) return p;
  return toPlotSpace(p, { x: base.x0, y: base.y0 }, bedDepth(plotIndex));
};

/** The plot a seed drag would land in, or null. Shared by the ring and the hint text. */
function dropTarget(): number | null {
  if (drag?.kind !== "seed") return null;
  const plot = plotAt(garden, pointer);
  return plot !== null && pointer.y < SOIL + 24 ? plot : null;
}

/**
 * There is no adaptive quality here, and that is a conclusion rather than an omission.
 *
 * Two mechanisms were tried against a throttled phone and BOTH were measured and both failed.
 *
 * Reducing the drawing resolution, on the reasoning that the bottleneck was pixels: at two
 * different device ratios the canvas held the SAME 0.36 megapixels and ran at 29.9 and 44.4
 * fps. The compositor works at the device's physical resolution whatever our backing store is,
 * so shrinking it bought nothing and cost sharpness.
 *
 * Drawing every other frame, on the reasoning that the cost was per-frame work: the loop rate
 * duly doubled, 28 fps to 45 — and the rate at which anything actually CHANGED ON SCREEN fell
 * from 28 to 22. Halving the draws halved what the player sees; the loop being free the rest of
 * the time is worth nothing to them.
 *
 * A drawn frame costs about 27ms on a 4x-slowed phone, of which under 4ms is JavaScript. The
 * remainder is rasterising and compositing a full-screen canvas, and the only real lever left
 * is not redrawing the parts that did not change — dirty-rectangle rendering, which the sway
 * makes genuinely hard, since a swaying plant dirties its whole bounding box every frame.
 *
 * Measured, so a later change can be compared against it: ~28fps at a 4x CPU slowdown and
 * ~17fps at 6x. Slow, and playable — nothing here is timed or requires aim.
 */

/**
 * The sky, painted once — held HERE and handed to `drawScene` every frame.
 *
 * The renderer is stateless on purpose (see `src/scene.ts`), so the one thing in the scene that
 * must survive between frames lives with the caller that owns the canvas. Invalidated only by a
 * relayout, which is the one thing that changes its size.
 */
let stageCache: HTMLCanvasElement | null = null;

function frame(nowMs: number = performance.now()): void {
  // Advance both clocks from ELAPSED TIME, at the top of the frame, so everything drawn below
  // reflects the time that has actually passed. `requestAnimationFrame` hands us its own
  // timestamp; the default argument covers the initial kick and any direct call from a test.
  //
  // The first frame has no predecessor and advances nothing, rather than measuring against a
  // zero that would resolve the whole of a plant's growth in one step.
  const dtMs = lastFrameMs === null ? 0 : nowMs - lastFrameMs;
  lastFrameMs = nowMs;
  const motionTicks = ticksElapsed(dtMs, MOTION_TICKS_PER_SECOND);
  growthNow += ticksElapsed(dtMs, GROWTH_TICKS_PER_SECOND);
  motionNow += motionTicks;

  // Composite anything newly retired before drawing, so a replaced plant appears in the
  // background on the same frame it leaves the bed rather than blinking out of existence.
  // A replaced plant RECEDES into the background rather than cutting to it.
  //
  // The placement is reserved here, as the plant leaves the bed, not when it finally lands:
  // several plants can be receding at once, so the layer index the buffer would compute at
  // composite time is not the one this plant is easing toward.
  if (garden.retired.length) {
    for (const gone of garden.retired) {
      const key = genomeSeed(gone.genome);
      receding.push({
        plant: gone.plant,
        key,
        place: placeRetired(key, forest.depth + receding.length, W),
        start: motionNow,
      });
      logRetirement(gone);
    }
    // DRAIN the queue. It used to be an ever-growing history, which made it an unbounded array
    // of the heaviest objects in the game — and because the render cache is keyed on the plant
    // object, holding the plant also pinned an offscreen canvas of it. The durable history is
    // `retirementLog`, which holds genome strings and is capped.
    garden = { ...garden, retired: [] };
    scheduleSave();
  }

  // Anything that has finished receding becomes pixels and stops costing a redraw.
  receding = receding.filter((r) => {
    if (motionNow - r.start < RECEDE_TICKS) return true;
    forest.retire(r.plant, r.key, r.place);
    return false;
  });

  recordGrownPlants();
  announceGrown();
  updateInsects(motionNow, W);
  for (const gone of takeExpired()) resolveDeparture(gone, didPollinate(rand));
  // Ambient insects are cheap and unconditional. Carriers are rare and gated against ticks
  // ELAPSED this frame, so one arrival per CARRIER_INTERVAL_TICKS holds however fast the
  // renderer runs — about ninety seconds either way. A fixed per-frame probability would make
  // carriers arrive at whatever rate the machine drew at, which is the same defect the clock
  // itself had: the gate was written as `SPEED / CARRIER_INTERVAL_TICKS` when `SPEED` was a
  // per-frame constant. Only fires when there is both somewhere to land and something to carry.
  if (rand() < 0.003) spawnAmbient(W, H, rand);
  if (
    rand() < motionTicks / CARRIER_INTERVAL_TICKS &&
    canCarrierArrive(retirementLog, bloomCount())
  ) {
    const pollen = pickPollen(retirementLog, rand);
    const spot = anyOpenBloom();
    if (pollen && spot) {
      spawnCarrier(pollen, spot.plotIndex, spot, motionNow);
      // An arrival changes what the player can do, so it is a milestone rather than ambience.
      announce(carrierLabel(pollen));
    }
  }
  syncA11y();

  // The whole picture, in one call — the same call a visit makes, so the two cannot drift.
  // Two clocks, both running, at different rates: the bed grows slowly and moves quickly. A
  // visit pins the first and keeps the second — same call, so the two pages cannot drift.
  stageCache = drawScene({
    ctx,
    W,
    H,
    SOIL,
    dpr,
    forest,
    occupants: garden.plots.map((p) => p.occupant),
    receding,
    now: growthNow,
    motionNow,
    stageCache,
  });

  // AFTER the soil, not before. Drawn first, every divot was painted over by the soil band
  // and the empty plots looked identical to bare ground — so the one affordance telling the
  // player where a seed can go was invisible.
  for (const [i, plot] of garden.plots.entries()) {
    if (!plot.occupant) paintPlotMarker(plotXs[i]!);
  }

  // Which plant the open card is about.
  //
  // Without this the card floats over the bed describing "a white raceme" while three white
  // racemes are on screen, and the player has to guess which one they held. A mark at the base
  // rather than around the canopy: a ring big enough to enclose a plant would dominate the
  // frame, and the base is where the plant meets its plot, which is the thing being identified.
  if (inspecting !== null) {
    const occ = garden.plots[inspecting]?.occupant;
    const base = occ?.plant.segments[0];
    if (base) {
      ctx.save();
      ctx.strokeStyle = "rgba(236,196,116,0.75)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(base.x0, base.y0 + 2, 17, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // After the bed, so an insect reads as being in front of the flower it has settled on rather
  // than buried behind the canopy.
  drawInsects(ctx, motionNow);

  // Affordance: ring whatever the pointer could act on right now.
  const hover = drag
    ? null
    : bloomAt(garden, pointer, growthNow, 1.15, localToPlot);
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
      const onto = bloomAt(garden, pointer, growthNow, 1.15, localToPlot);
      // A pollen carrier has no source plot, and crossing it into the flower it was sitting on
      // is perfectly legal — so unlike a bloom drag, every bloom under the pointer is a valid
      // target and gets the ring.
      const sameSource =
        drag.kind === "bloom" && onto?.plotIndex === drag.plotIndex;
      if (onto && !sameSource)
        paintHalo(onto.bloom.center, onto.bloom.radius * 1.3, 0.85);
    }
  }

  if (flash && motionNow < flash.until) {
    // Clamped. `now < flash.until` bounds k BELOW but not above, so a clock that jumps
    // backwards gives k > 1.29 and an arc radius of -44 — which throws, and a throw inside
    // the rAF callback stops the loop being rescheduled, freezing the entire game with no
    // visible cause. One unclamped interpolation took the whole render loop down.
    const k = Math.min(1, Math.max(0, (flash.until - motionNow) / FLASH_TICKS));
    paintHalo(flash.at, 10 + 34 * (1 - k), 0.55 * k);
  }

  // A notice outranks the hint. It is the only channel for "your save was rejected" or "that
  // share link is not a genome", and burying either under a hint would be silent failure with
  // extra steps.
  hintEl.textContent = notice || hint();
  hintEl.classList.toggle("notice", Boolean(notice));

  const share = garden.tray.length ? serialize(garden.tray.at(-1)!.genome) : "";
  if (share !== lastShare) {
    lastShare = share;
    codeEl.textContent = share ? `${share} — copy link` : "";
  }

  requestAnimationFrame(frame);
}

let lastShare = "";

/** The share URL for a genome: the code lives in the fragment, so it never hits a server. */
function shareUrl(code: string): string {
  return `${location.origin}${location.pathname}#g=${code}`;
}

codeEl.addEventListener("click", () => {
  if (!garden.tray.length) return;
  const code = serialize(garden.tray.at(-1)!.genome);
  void navigator.clipboard
    .writeText(shareUrl(code))
    .then(() => {
      notice =
        "link copied — it grows this exact flower for anyone who opens it";
      setTimeout(() => {
        notice = "";
      }, 3200);
    })
    .catch((e: Error) => {
      // Clipboard access is permission-gated and fails in plenty of contexts. Show the URL
      // so the player can still copy it by hand rather than being told nothing happened.
      notice = `could not copy (${e.message}) — ${shareUrl(code)}`;
    });
});

/**
 * The first-run pass.
 *
 * Staged rather than a wall of instructions, and it retires itself: each line is shown until
 * the player has done that thing once, then never again. A game with four verbs and no menus
 * has to teach them somehow, and the alternative — a static list — is both ignored and
 * permanent.
 *
 * Ordered so each lesson is possible when it appears: you cannot plant before you have a seed.
 * SELF comes last because it is the one verb whose PURPOSE needs saying — the others are
 * discoverable by poking at flowers, but nothing about the garden suggests that crossing a
 * plant with itself is how you find out what it is carrying.
 */
const LEARNED_KEY = "heirloom.learned.v1";
type Verb = "clone" | "plant" | "cross" | "self" | "read";

/**
 * Each lesson carries a condition for being WORTH showing, not only for being unlearned.
 *
 * Without it the sequence gives stale advice: a player whose first move is a cross has a seed
 * in the tray and is still being told how to get one, because "clone" is technically
 * unlearned. Telling someone to do a thing they have already achieved by another route is
 * worse than saying nothing — it reads as the game not watching.
 */
const LESSONS: { verb: Verb; text: string; when: () => boolean }[] = [
  {
    verb: "clone",
    text: "click a flower to take a seed",
    // Not shown to someone who has already got a seed by selfing or crossing. They have
    // demonstrated they can fill the tray; repeating the most basic instruction back at them
    // reads as the game not having noticed.
    when: () =>
      garden.tray.length === 0 && !learned.has("self") && !learned.has("cross"),
  },
  {
    verb: "plant",
    text: "drag a seed from the tray onto a bare plot",
    when: () => garden.tray.length > 0,
  },
  {
    verb: "cross",
    text: "drag one plant's flower onto another's to cross them",
    when: () => garden.plots.filter((p) => p.occupant).length > 1,
  },
  {
    verb: "self",
    text: "drag a flower onto its OWN plant to self it — how to find what it hides",
    when: () => true,
  },
  {
    verb: "read",
    text: "press and hold a plant to read what you know about it",
    when: () => true,
  },
];

const learned = new Set<Verb>(
  (() => {
    try {
      const raw = localStorage.getItem(LEARNED_KEY);
      return Array.isArray(JSON.parse(raw ?? "null"))
        ? (JSON.parse(raw!) as Verb[])
        : [];
    } catch {
      // A corrupt teaching record is worth nothing and costs nothing: show the lessons again.
      return [];
    }
  })(),
);

function learn(v: Verb): void {
  if (learned.has(v)) return;
  learned.add(v);
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify([...learned]));
  } catch {
    // Storage can be full or disabled. The lesson simply reappears next session, which is a
    // far better failure than blocking a verb on being able to write to disk.
  }
}

function teachingHint(): string | null {
  for (const l of LESSONS) if (!learned.has(l.verb) && l.when()) return l.text;
  return null;
}

function hint(): string {
  // A keyboard player told to "drop it on another plant's flower" has been handed an instruction
  // they cannot follow, by a game that appears not to know how it is being played. Naming the
  // wrong gesture is worse than naming none.
  if (usingKeys) {
    if (held?.kind === "seed")
      return "Enter on a plot to sow it · Escape to put it back";
    if (held?.kind === "plot")
      return "Enter on another plant to cross · Enter again here to self it";
    return (
      teachingHint() ?? "Tab to move · Enter to pick up · C clone · R read"
    );
  }
  if (drag?.kind === "seed") {
    const plot = dropTarget();
    if (plot !== null && garden.plots[plot]!.occupant)
      return "drop here to REPLACE the plant growing in this plot";
    return "drop it on a plot to plant it";
  }
  if (drag?.kind === "bloom")
    return "drop it on another plant's flower to cross · on its own to self it";
  return teachingHint() ?? "click a plant's stem to read it";
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
  /** The packed garden code, for a driver to compare against what the share button copies. */
  __gardenCode: () => gardenPostcard(),
  __seek: (t: number) => {
    growthNow = t;
  },
  __state: () => ({
    tray: garden.tray.length,
    planted: garden.plots.filter((p) => p.occupant).length,
    retired: garden.retiredTotal,
    empty: garden.plots.findIndex((p) => !p.occupant),
    occupied: garden.plots
      .map((p, i) => (p.occupant ? i : -1))
      .filter((i) => i >= 0),
    forestDepth: forest.depth,
    forestCoverage: forest.coverage(),
    /** Plants mid-flight between the bed and the background. */
    receding: receding.length,
  }),
  /**
   * Canvas-space centres of every flower currently on screen — where they are DRAWN.
   *
   * Plants are painted through a depth transform, so a flower's position in its own plant's
   * coordinates is not where it appears. Every driver uses this to aim a pointer at a real
   * flower; returning untransformed coordinates made them click at where flowers used to be,
   * and the resulting failures read as "no seed was taken" rather than as "the hook is lying".
   */
  __blooms: () =>
    garden.plots.flatMap((plot, plotIndex) => {
      const occ = plot.occupant;
      if (!occ) return [];
      const base = occ.plant.segments[0];
      const anchor = { x: base?.x0 ?? 0, y: base?.y0 ?? 0 };
      const d = bedDepth(plotIndex);
      return bloomsOf(occ, growthNow).map((b) => {
        const at = toCanvasSpace(b.center, anchor, d);
        return { plotIndex, x: at.x, y: at.y };
      });
    }),
  /** Serialized genomes, for asserting a save round-tripped the actual plants. */
  __codes: () => ({
    plots: garden.plots.map((p) =>
      p.occupant ? serialize(p.occupant.genome) : null,
    ),
    tray: garden.tray.map((s) => serialize(s.genome)),
  }),
  /** What the keyboard is holding, so a driver can assert a pickup without reaching inside. */
  __held: () => held,
  /** Tray seed origins, so a driver can assert provenance without decoding a save. */
  __origins: () => garden.tray.map((s) => s.origin ?? "none"),
  /** Live insects, so a driver can see one without waiting for a rare random arrival. */
  __insects: () =>
    insects().map((i) => ({
      x: i.x,
      y: i.y,
      pollen: i.pollen,
      plotIndex: i.plotIndex,
    })),
  /**
   * Force a carrier onto a real open bloom. Returns false when nothing is in bloom.
   *
   * The alternative is a driver that waits for a once-every-ninety-seconds event, which is a
   * flaky test by construction. The arrival RULE is unit-tested; this hook exists so the driver
   * can test everything downstream of it.
   */
  __spawnCarrier: (pollen: string) => {
    const spot = anyOpenBloom();
    if (!spot) return false;
    spawnCarrier(pollen, spot.plotIndex, spot, motionNow);
    announce(carrierLabel(pollen));
    return true;
  },
  /**
   * Expire every carrier now, with the pollination roll FORCED.
   *
   * Removes the driver's dependence on a one-in-seven event. The probability itself is measured
   * over twenty thousand draws in test/pollinator.test.ts, where it costs a millisecond instead
   * of a browser and a wait that would sometimes be wrong.
   */
  __expireCarriers: (pollinated: boolean) => {
    for (const bug of insects().filter((i) => i.pollen)) {
      removeInsect(bug);
      resolveDeparture(bug, pollinated);
    }
  },
  __traySlot: (i: number) => traySlot(i, W, H),
  __plotCount: () => plotXs.length,
  __plotX: (i: number) => plotXs[i],
  __soil: SOIL,
  __size: () => ({ w: W, h: H }),
  /** The garden clock, so a driver can reason about anything measured in ticks. */
  __now: () => growthNow,
  /**
   * Plants mid-flight, on its own so a driver can POLL it.
   *
   * `__state()` reads the whole background buffer back with `getImageData` to report coverage,
   * which costs a megapixel per call. Polling that once per frame starves the very frame loop
   * the poll is waiting on — the recede never completed because asking whether it had finished
   * was what stopped it finishing.
   */
  __receding: () => receding.length,
  /**
   * Plot occupancy WITHOUT the buffer readback.
   *
   * `__state()` reports background coverage, which costs a `getImageData` over the whole
   * buffer. A driver that calls it once per round spends its entire budget there — the first
   * soak run did a hundred rounds in over twenty minutes and never reached its first sample.
   */
  __plots: () => ({
    tray: garden.tray.length,
    empty: garden.plots.findIndex((p) => !p.occupant),
    occupied: garden.plots
      .map((p, i) => (p.occupant ? i : -1))
      .filter((i) => i >= 0),
  }),
  __forestDepth: () => forest.depth,
  /** Cumulative retirements, without the buffer readback `__state()` costs. */
  __retiredTotal: () => garden.retiredTotal,
  /**
   * Plant the tray's first seed straight into a plot.
   *
   * For the depth measurement, which needs every plot holding the SAME genome so that any
   * visual difference between plants is the renderer talking about position rather than about
   * genetics. Driving the pointer for that would only add ways for a measurement of PIXELS to
   * fail for reasons that are not about pixels.
   */
  __plantInto: (plot: number) => {
    const seed = garden.tray[0];
    if (!seed) return false;
    garden = plantSeed(garden, seed.id, plot, SOIL, growthNow);
    return true;
  },
  /**
   * Each occupied plot's drawn bounding box, in canvas coordinates.
   *
   * For measuring the render rather than the model: "is there any depth cue between these two
   * plants" is a question about pixels, and pixels have to be attributed to a plant somehow.
   */
  __plantBoxes: () =>
    garden.plots
      .map((p, i) => {
        const occ = p.occupant;
        if (!occ) return null;
        const age = growthNow - occ.plantedAt;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const sg of occ.plant.segments) {
          if (sg.tick > age) continue;
          minX = Math.min(minX, sg.x0, sg.x1);
          maxX = Math.max(maxX, sg.x0, sg.x1);
          minY = Math.min(minY, sg.y0, sg.y1);
          maxY = Math.max(maxY, sg.y0, sg.y1);
        }
        for (const b of occ.plant.blooms) {
          if (b.tick > age) continue;
          minX = Math.min(minX, b.center.x - b.radius);
          maxX = Math.max(maxX, b.center.x + b.radius);
          minY = Math.min(minY, b.center.y - b.radius);
          maxY = Math.max(maxY, b.center.y + b.radius);
        }
        if (minX === Infinity) return null;
        // Returned in DRAWN coordinates, not the plant's own.
        //
        // The plant is painted through the depth transform, so its untransformed bounds are
        // the wrong place to look for its pixels — and the error grows with depth, which is
        // precisely the variable under study. Measured that way, "drawn size versus depth"
        // came out at +0.6: further plants appeared LARGER, because their boxes were too big
        // and swept in more background.
        const base = occ.plant.segments[0];
        const d = bedDepth(i);
        const anchor = { x: base?.x0 ?? 0, y: base?.y0 ?? 0 };
        const a = toCanvasSpace({ x: minX, y: minY }, anchor, d);
        const b = toCanvasSpace({ x: maxX, y: maxY }, anchor, d);
        return {
          plot: i,
          depth: d.depth,
          minX: a.x,
          maxX: b.x,
          minY: a.y,
          maxY: b.y,
          baseX: anchor.x,
          baseY: anchor.y + d.dy,
        };
      })
      .filter(Boolean),
  /** What the notebook has filed, and what it concludes — for driving the carrier discovery. */
  __notebook: () => ({
    crosses: notebook.crosses.length,
    carries: garden.plots.map((p) =>
      p.occupant
        ? carriedBy(notebook, serialize(p.occupant.genome)).map((c) => c.locus)
        : null,
    ),
  }),
  /** The card's visible text, so a driver asserts what the PLAYER sees, not internal state. */
  __card: () => (cardEl.hidden ? null : cardEl.textContent),
  /**
   * The drawer as the player sees it: is it open, and how many entries are actually IN THE DOM.
   *
   * Counting rendered figures rather than `retirementLog.length` on purpose — the latter would
   * report entries the panel failed to draw, which is exactly the bug a driver is here to catch.
   */
  /**
   * Retired plants still waiting to be composited into the background on load.
   *
   * `__ready` now means "the garden responds", which is what a player cares about, and the
   * background finishes filling in behind it. A driver that asserts on background PIXELS has to
   * wait for this to reach 0 — otherwise it races the drain and fails intermittently, which is
   * worse than being slow.
   */
  __restorePending: () => restoreQueue.length,
  __drawer: () => ({
    open: drawerOpen,
    entries: drawerEl.querySelectorAll("figure").length,
  }),
  /**
   * Restore the drawer's first entry.
   *
   * A hook rather than a click because the figures live in a SCROLLING panel: a driver aiming
   * pointer coordinates at one would be testing the scroll position as much as the restore.
   * The click path itself is exercised separately, by clicking a figure directly.
   */
  __restoreFirst: () => {
    const first = drawerEl.querySelector("figure") as HTMLElement | null;
    return first ? restoreFromDrawer(first.dataset["code"]) : false;
  },
  /** A point on a plant's stem, for opening its card without hitting a flower. */
  __stemAt: (i: number) => {
    const occ = garden.plots[i]?.occupant;
    if (!occ) return null;
    const s = occ.plant.segments[Math.min(3, occ.plant.segments.length - 1)];
    const base = occ.plant.segments[0];
    if (!s || !base) return null;
    // Drawn coordinates, for the same reason as `__blooms`.
    return toCanvasSpace(
      { x: s.x0, y: s.y0 },
      { x: base.x0, y: base.y0 },
      bedDepth(i),
    );
  },
  __hint: () => hintEl.textContent,
});
