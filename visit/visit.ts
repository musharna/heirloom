/**
 * A VISIT — someone else's garden, read-only.
 *
 * Read-only by CONSTRUCTION. This module does not import the four verbs, the writer that
 * persists a garden to localStorage, or the bees, so no guard can be forgotten: a function
 * that is not on the module graph cannot be called by accident. The alternative — a `visiting`
 * flag inside the game controller — needed six guards whose failure mode was silently writing
 * a stranger's garden over the visitor's.
 *
 * Those four modules are named by PATH nowhere in this file, deliberately: the check that the
 * rule still holds is a grep, and a grep that its own explanation trips is a check nobody
 * trusts twice. What it is really asserting is the transitive import graph below.
 */
import { grow } from "../src/game/garden";
import { plotLabel } from "../src/game/describe";
import { computeLayout, plotPositions, SOIL_BAND } from "../src/game/layout";
import {
  FROZEN_CLOCK,
  readPostcard,
  type Postcard,
} from "../src/game/postcard";
import { genomeSeed, serialize } from "../src/genome/serialize";
import { Forest } from "../src/render/accumulate";
import { cachedCount } from "../src/render/cache";
import { SPEED } from "../src/render/motion";
import { drawScene, type SceneOccupant } from "../src/scene";

const wrap = document.getElementById("wrap")!;
const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const strip = document.getElementById("strip")!;
const stripText = document.getElementById("strip-text")!;
const mirror = document.getElementById("mirror")!;
const say = document.getElementById("say")!;

let failure: string | null = null;

function fail(message: string): void {
  // §10: name what went wrong. An empty garden rendered silently would read as the sender
  // having nothing to show, which is a lie about someone else's afternoon — so the canvas is
  // removed from the page as well as left unpainted. A bed with nine bare plots IS a garden,
  // and drawing one here would be the exact confusion this message exists to prevent.
  failure = message;
  strip.classList.add("notice");
  stripText.textContent = `that garden link could not be opened — ${message}`;
  document.getElementById("strip-back")!.textContent = "start your own garden";
  wrap.hidden = true;
  say.textContent = stripText.textContent;
}

/**
 * The code is taken up to the next `&` and handed to the codec UNVALIDATED.
 *
 * Deliberately not `([A-Za-z0-9_-]+)`: that pattern stops at the first illegal character and
 * passes the TRUNCATED prefix on, so a link with one bad byte in the middle is reported as a
 * checksum failure rather than as the illegal character it is. What counts as a legal code is
 * `readPostcard`'s to decide, and it already says so precisely.
 */
const code = /[#&]garden=([^&]*)/.exec(location.hash);
const result = code ? readPostcard(code[1]!) : null;
if (!code) fail("there is no garden in this link");
else if (result && !result.ok) fail(result.error);

const postcard: Postcard | null = result?.ok ? result.postcard : null;

/**
 * The SENDER's world, scaled to fit — not reflowed to the visitor's plot count.
 *
 * A visit is a photograph, and a photograph letterboxes. Reflowing would also distort the
 * bed-to-forest scale gap (1.00-0.86 against 0.82) that keeps live plants legible as the
 * subject; `src/game/layout.ts:31` explicitly warns against trading it away.
 */
const W = postcard?.W ?? 1180;
const H = postcard?.H ?? 470;
const SOIL = H - SOIL_BAND;
const dpr = Math.min(2, window.devicePixelRatio || 1);

function fit(): void {
  // `computeLayout` measures the VISITOR's available box — its margins are the only part of it
  // a visit wants. Its plot count and its world size belong to the visitor's own garden.
  const box = computeLayout(window.innerWidth, window.innerHeight);
  const scale = Math.min(box.W / W, box.H / H);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${Math.round(W * scale)}px`;
  canvas.style.height = `${Math.round(H * scale)}px`;
  // Resizing a canvas resets its transform, so this must follow the width/height writes.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * The growth clock is PINNED.
 *
 * Each plant is grown to the age it had when the link was made, by planting it that many ticks
 * in the past against a clock that never advances. The value lives with the codec, next to the
 * age ceiling it has to clear — see `FROZEN_CLOCK`.
 */
const FROZEN = FROZEN_CLOCK;

const forest = new Forest(W, H, dpr);
for (const entry of postcard?.forest ?? [])
  forest.retire(
    grow(entry.genome, entry.x, SOIL).plant,
    genomeSeed(entry.genome),
  );

// Positions come from plotPositions(W, plotCount) — the SENDER's world and the SENDER's plot
// count. computeLayout() would be wrong here: it derives the count from the visitor's viewport,
// which is exactly the reflow this design rejects.
const xs = plotPositions(W, postcard?.plotCount ?? 0);
const occupants: (SceneOccupant | null)[] = (postcard?.plots ?? []).map(
  (p, i) =>
    p
      ? { ...grow(p.genome, xs[i] ?? W / 2, SOIL), plantedAt: FROZEN - p.age }
      : null,
);

let stageCache: HTMLCanvasElement | null = null;
let motionNow = 0;

function frame(): void {
  // Growth is frozen; MOTION is not. `now` never moves, `motionNow` does — the two-clock
  // signature on `drawScene` exists for exactly this.
  motionNow += SPEED;
  stageCache = drawScene({
    ctx,
    W,
    H,
    SOIL,
    dpr,
    forest,
    occupants,
    receding: [],
    now: FROZEN,
    motionNow,
    stageCache,
  });
  requestAnimationFrame(frame);
}

if (!failure) {
  fit();
  window.addEventListener("resize", fit);
  requestAnimationFrame(frame);
}

// A blind visitor hears the bed they are visiting. A list, not buttons: there is nothing to
// activate. `plotLabel` rather than a phrasing of its own — it already carries the isGrown gate
// that keeps an unfinished plant from disclosing its traits, and a visit is not a loophole in
// §4.
mirror.replaceChildren(
  ...occupants.map((occ, i) => {
    const li = document.createElement("li");
    li.textContent = plotLabel(i, occ, FROZEN);
    return li;
  }),
);

declare global {
  interface Window {
    __visitReady?: boolean;
    __visitPlots?: () => (string | null)[];
    __visitError?: () => string | null;
    __visitCached?: () => { cached: number; of: number };
  }
}
window.__visitPlots = () =>
  occupants.map((o) => (o ? serialize(o.genome) : null));
window.__visitError = () => failure;
/**
 * How many of the visited plants are being blitted from a cached image.
 *
 * Exposed because a visit is the ONE page where this can silently be zero forever. The garden's
 * clock advances past `settledTick` within a second of a plant finishing; a visit's clock never
 * advances at all, so if the age it was sent is below the settle point the cache can never
 * engage — not once, not later. That was the shipped behaviour, and nothing on the page said
 * so except the frame rate.
 */
window.__visitCached = () => ({
  cached: cachedCount(occupants.flatMap((o) => (o ? [o.plant] : []))),
  of: occupants.filter(Boolean).length,
});
window.__visitReady = true;
