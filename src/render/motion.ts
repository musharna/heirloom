/**
 * Idle motion: sway, and wind crossing the bed.
 *
 * PAINT-TIME ONLY, and that is the whole architecture of this file. §6 makes growth
 * deterministic from the genome alone so a shared link grows the same plant for everyone; if
 * motion touched `Plant` it would either break that or have to be replayed exactly, and both
 * are worse than the alternative. Nothing here is ever written back — the geometry a plant is
 * made of is identical whether it is swaying or still.
 *
 * The displacement is an AFFINE SHEAR anchored at the plant's base: every point moves
 * sideways in proportion to how far above the base it is. That is one `ctx.transform` for a
 * whole plant — stems, leaves, flowers and their gradients all bend together — where the
 * obvious alternative, displacing each vertex, would mean rebuilding every outline each frame
 * and would still need this same rule to decide by how much.
 *
 * Real stems bend more than linearly, as a cantilever does. Linear is the cheap approximation
 * and it is exact where it matters most: at the base, where a plant that slid sideways out of
 * its own soil would be unmissable.
 */

/**
 * Ticks per SECOND, not per frame — and there are two of them, because the game has two tempos.
 *
 * These replaced a single `SPEED = 1.4` that was added to the frame counter once per
 * `requestAnimationFrame`. That made every duration in the game a function of the frame rate:
 * measured 2026-08-04, the clock advanced ~1.4 ticks per frame at 6.5fps and at 60fps alike, so
 * a plant took ~8.4s to grow here and would take ~1.55s on a machine that held 60fps throughout.
 * An animation whose length depends on how fast the renderer happens to be is not a tuned
 * animation, and no test could have caught it: every consumer agreed with every other one.
 *
 * The coupling was doing real work by accident, which is why removing it needs TWO rates rather
 * than one. Growth is expensive and settled painting is cheap, so the frame rate itself was
 * acting as an unintended tempo control — slow while a plant unfurled, fast once the bed
 * settled. A single time-based rate cannot reproduce that: pick the settled tempo and growth
 * becomes a blink, pick the growth tempo and the garden stops swaying.
 *
 * Here rather than in `garden/garden.ts` because they are not the game's alone: a VISIT advances
 * `motionNow` at this same rate so a shared garden sways exactly as it did for the sender, and
 * `src/game/pollinator.ts` states its durations in ticks against it. A second copy of a tick
 * rate would let one of those three drift silently — the sway would simply run at the wrong
 * speed, with nothing to fail.
 */

/**
 * Sway, gusts, insects, the recede animation and the plant-flash.
 *
 * 84 = the old 1.4 per frame at 60fps exactly, so a garden that already held 60fps — which is
 * every settled bed, measured 60.1–60.4fps — moves at precisely the tempo this was tuned at.
 * Nothing about the resting garden changes.
 */
export const MOTION_TICKS_PER_SECOND = 84;

/**
 * Growth, and flowers opening. Deliberately NOT 84.
 *
 * The old rate reached ~17 ticks/s during growth on this machine, because growth is the
 * expensive path: measured 6.5fps with a settled-complexity bed, against 60fps once cached. A
 * plant therefore took ~8.4s to reach its settle point, and that is what the value was tuned
 * against — 1.4 entered in e2c843a, the same commit that added petal shading and the
 * multi-plant garden and so created the cost. Preserving the duration that was actually tuned
 * beats inheriting the one a faster renderer would have produced.
 *
 * This is the knob. Raise it and plants unfurl faster on every machine; growth no longer gets
 * quicker just because the renderer got faster.
 */
export const GROWTH_TICKS_PER_SECOND = 17;

/**
 * Longest frame gap that may advance a clock, in milliseconds. A BACKSTOP, not the pause.
 *
 * Frame counting had one accidental virtue: a backgrounded tab stops getting frames, so the
 * garden paused. Wall-clock time does not pause, and without a cap a tab restored after ten
 * minutes would resolve 50,000 ticks in one step — every plant fully grown, every gust skipped.
 *
 * The obvious cap — around 100ms, a few frames at 60fps — is WRONG here, and measurably so. A
 * growing bed runs at 6.5fps, which is 154ms a frame: a 100ms cap would silently throttle the
 * clock on exactly the machine and the moment this change exists to fix, and growth would go
 * back to running slower when the renderer does. The cap cannot tell "this tab is not being
 * drawn" from "this frame was expensive", so it must not be the thing that decides.
 *
 * Hiding the tab is instead handled where the browser states it outright, on `visibilitychange`
 * — see the handlers in `garden/garden.ts` and `visit/visit.ts`. This value is left as a
 * backstop for stalls the event does not cover: a long GC, a blocking dialog, a paused
 * debugger. 250ms is 4fps, below which nothing about the garden works anyway.
 */
export const MAX_FRAME_MS = 250;

/**
 * Ticks elapsed for a frame delta, clamped.
 *
 * Negative deltas are clamped to zero rather than trusted: `performance.now()` is monotonic,
 * but the first frame after a resize or a restore computes its delta against a timestamp that
 * may never have been set, and a clock that runs backwards un-grows a plant.
 */
export function ticksElapsed(dtMs: number, perSecond: number): number {
  return (Math.min(Math.max(dtMs, 0), MAX_FRAME_MS) / 1000) * perSecond;
}

/** Radians-per-tick of the slow component. A full breath takes ~500 ticks. */
const W_SLOW = 0.0125;
/** A faster, smaller component. Summing two incommensurate periods stops the sway from
 * reading as a metronome — a single sine is recognisably mechanical within a few seconds. */
const W_FAST = 0.031;

/**
 * Shear per unit height. 0.012 displaces a 250px-tall plant by 3px at its tip.
 *
 * Deliberately small. Hit-testing uses the plant's RESTING coordinates, so every pixel of
 * sway is a pixel of disagreement between where a flower is drawn and where it can be
 * clicked; at this amplitude the offset stays far inside `bloomAt`'s slack. It also happens to
 * be about what a real stem does indoors, which is the effect being aimed at — the garden
 * should look alive, not windswept.
 */
export const IDLE_AMPLITUDE = 0.012;

/** How much harder a gust pushes than the idle breath. */
export const GUST_AMPLITUDE = 0.05;

/** Ticks for one gust to cross the world and the next to begin. */
export const GUST_PERIOD = 2600;
/** Half-width of a gust's leading edge, in px. Wide enough to move several plants at once. */
export const GUST_SPAN = 260;

/**
 * A plant's own phase, from its genome hash.
 *
 * Derived rather than random so a plant sways identically wherever it is opened — the same
 * reason placement in the background forest is derived (see `placeRetired`). Two plants of the
 * same genome standing side by side WILL sway in lockstep, which is correct: they are the same
 * plant, and a garden of clones moving as one is a truthful picture of what the player bred.
 */
export function swayPhase(genomeKey: number): number {
  // Golden-ratio multiplier spreads adjacent hashes across the whole cycle, so two genomes
  // differing in one bit do not come out nearly in phase.
  return ((genomeKey >>> 0) * 0.618033988749895 * Math.PI * 2) % (Math.PI * 2);
}

/**
 * Where the current gust's centre is, in world x.
 *
 * Travels left to right and starts off-screen on both sides, so a gust arrives and departs
 * rather than appearing in the middle of the bed. Between gusts the centre is far off the
 * right-hand edge and its contribution is nil, which is what makes the wind occasional
 * instead of a constant breeze.
 */
export function gustCenter(t: number, worldW: number): number {
  const span = worldW + GUST_SPAN * 4;
  return ((t % GUST_PERIOD) / GUST_PERIOD) * span - GUST_SPAN * 2;
}

/** How strongly the gust is felt at world x: a soft bell around its centre. */
export function gustAt(t: number, x: number, worldW: number): number {
  const d = (x - gustCenter(t, worldW)) / GUST_SPAN;
  return Math.exp(-d * d);
}

export type SwayOpts = {
  /** 0..1 from the phenotype. A stiff stem bends less; a slack one bends more. */
  stiffness?: number;
};

/**
 * The shear coefficient for one plant at one instant.
 *
 * Pure, so the whole motion model is testable without a canvas — which matters more here than
 * usual, because "does it look alive" is not something a test can answer and "does it ever
 * move the plant out of its own soil" very much is.
 */
export function swayAt(
  t: number,
  genomeKey: number,
  x: number,
  worldW: number,
  opts: SwayOpts = {},
): number {
  const phase = swayPhase(genomeKey);
  // A slack plant sways further than a stiff one. Clamped so a stiffness outside 0..1 — which
  // the phenotype does not produce today, but a later tuning pass might — cannot invert the
  // motion or send the amplitude somewhere absurd.
  const give = 1.35 - Math.min(1, Math.max(0, opts.stiffness ?? 0.5));
  const idle =
    Math.sin(t * W_SLOW + phase) * 0.75 +
    Math.sin(t * W_FAST + phase * 1.7) * 0.25;
  const gust =
    gustAt(t, x, worldW) * Math.sin(t * W_FAST * 1.6 + x * 0.01 + phase);
  return give * (IDLE_AMPLITUDE * idle + GUST_AMPLITUDE * gust);
}

/**
 * Apply a shear that leaves the base exactly where it was.
 *
 * x' = x + k(y - baseY). As a canvas matrix that is a horizontal skew with a compensating
 * translation; the compensation is what pins y = baseY to zero displacement. Without it the
 * whole plant slides sideways, roots and all.
 */
export function applySway(
  ctx: CanvasRenderingContext2D,
  k: number,
  baseY: number,
): void {
  ctx.transform(1, 0, k, 1, -k * baseY, 0);
}

/** Where a point ends up under a given shear. Exposed so tests can assert the geometry. */
export function shearPoint(
  p: { x: number; y: number },
  k: number,
  baseY: number,
): { x: number; y: number } {
  return { x: p.x + k * (p.y - baseY), y: p.y };
}

/** Ticks a replaced plant takes to recede into the background. */
export const RECEDE_TICKS = 70;

/** Smoothstep. Starts and ends at rest, so the recede has no visible kick at either end. */
export function ease(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

export type Placed = {
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  blur: number;
};

/**
 * A placement partway between "standing in the bed" and "part of the background".
 *
 * At u = 0 this is the IDENTITY — no offset, full size, fully opaque, unblurred — and at u = 1
 * it is exactly the placement the accumulation buffer will composite. Both endpoints matter.
 * The animation hands over to a `drawImage` of the composited buffer, so any disagreement
 * between the last animated frame and the composite appears as a jump at precisely the moment
 * the player is watching that plant; and any disagreement at the start is a jump the instant
 * they drop a seed on it.
 */
export function lerpPlacement(place: Placed, u: number): Placed {
  const e = ease(u);
  return {
    dx: place.dx * e,
    dy: place.dy * e,
    scale: 1 + (place.scale - 1) * e,
    alpha: 1 + (place.alpha - 1) * e,
    blur: place.blur * e,
  };
}

/**
 * Set up the canvas to draw a plant at a given placement, about its own base.
 *
 * Shared by the recede animation and the buffer composite so the two cannot drift apart. The
 * translate-scale-translate sandwich is what makes the plant shrink toward its own root rather
 * than toward the canvas origin.
 */
export function applyPlacement(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  place: Placed,
): void {
  ctx.globalAlpha = place.alpha;
  // A zero-radius blur still forces the compositor down a filtered path in some engines, and
  // it is the state every live plant is drawn in, so it is worth skipping outright.
  if (place.blur > 0.01) ctx.filter = `blur(${place.blur.toFixed(2)}px)`;
  ctx.translate(origin.x + place.dx, origin.y + place.dy);
  ctx.scale(place.scale, place.scale);
  ctx.translate(-origin.x, -origin.y);
}
