/**
 * World geometry chosen from the viewport.
 *
 * The world used to be three constants (1180 x 470, soil at 390) with plot positions derived
 * from them. That is correct for exactly one screen. On a phone the same 1180-wide world was
 * scaled down to a 396x158 strip — undistorted, after the aspect fix, but a strip.
 *
 * Pure and exported so the whole rule is testable without a DOM. Every dimension the game
 * uses comes from here, so there is one place where "what shape is the world" is decided.
 */
export type Layout = {
  W: number;
  H: number;
  /** Y of the soil surface. Below it is the band the seed tray rests on. */
  soil: number;
  plotXs: number[];
};

/**
 * Horizontal room one plant needs before its canopy starts colliding with a neighbour.
 *
 * Was 175, and that number was measured when the bed was a FLAT PLANE. `src/render/bed.ts`
 * gave the bed depth in a later milestone, and `paintOrder` now paints plots furthest-first,
 * so a nearer plant OCCLUDES a further one instead of interpenetrating it. Overlap that used
 * to read as collision now reads as depth — which is what makes tighter packing available
 * without shrinking a single plant.
 *
 * 110 rather than a rounder number because it is what yields nine plots on a 1180 world:
 * floor(910 / 110) + 1 = 9. At 115 the same formula gives 8.
 *
 * Do NOT buy plots by scaling plants down instead. The bed runs scale 1.00-0.86 against the
 * forest's 0.82-0.64, and that 0.86/0.82 gap is what keeps live plants legible as the subject;
 * a global 0.85 would put the bed's far end at 0.73, inside the forest, and the two would read
 * as one continuous field.
 */
export const MIN_PLOT_WIDTH = 110;
/** Room below the soil surface for the seed tray to sit ON the dirt rather than under it. */
export const SOIL_BAND = 80;

export const MIN_W = 360;
export const MAX_W = 1180;

/**
 * Height is clamped to a NARROW band, unlike width.
 *
 * A plant is roughly 250px tall whatever the screen is, so height is not a free parameter:
 * below ~430 the canopy runs out of headroom, and above ~470 the extra is empty sky. A tall
 * portrait phone therefore gets letterboxing rather than a taller world, because a taller
 * world would just be more darkness.
 */
export const MIN_H = 430;
/**
 * 470, not a rounder 500: this is the height the desktop composition was actually tuned to
 * by eye — the canvas went 520 -> 470 because the headroom above the plants was larger than
 * the plants. A generalisation that silently changed the number it was generalising FROM is
 * a regression dressed up as a refactor.
 */
export const MAX_H = 470;

export const MIN_PLOTS = 2;
export const MAX_PLOTS = 9;

/**
 * How many retired plants are composited into the background on load.
 *
 * Held at the old REPLAY_CAP (see `./save`) so load time is exactly what it was. Beyond this
 * depth a layer has washed out to under 5% contrast (see `effectiveDepth`) and would be
 * invisible anyway, so paying `growPlant` for it buys nothing.
 */
export const BACKGROUND_REPLAY = 60;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Where N plots sit in a world W wide.
 *
 * Exported because the VISIT needs to place the sender's plots in the sender's world, and
 * `computeLayout` cannot answer that — it decides the count from the local viewport. A second
 * copy of this arithmetic would put a visited garden's plants at subtly different positions
 * than the garden it was made from, which is the one thing a photograph must not do.
 */
export function plotPositions(W: number, plots: number): number[] {
  if (plots <= 0) return [];
  // Inset scales with width instead of staying at 135. A fixed inset on a 396-wide world
  // would eat two thirds of it, leaving the plots crushed into the middle.
  const inset = Math.min(135, W * 0.14);
  const usable = W - inset * 2;
  if (plots === 1) return [W / 2];
  return Array.from(
    { length: plots },
    (_, i) => inset + (i / (plots - 1)) * usable,
  );
}

/**
 * How much room a page actually has, before any clamping: the viewport less the chrome.
 *
 * Split out of `computeLayout` because the two questions it used to answer inside one function
 * are genuinely different, and a VISIT needs the first without the second. `computeLayout` goes
 * on to clamp H to [MIN_H, MAX_H] — a WORLD height, deliberately floored at 430 so a short
 * screen gets letterboxing rather than a world made of sky. Read back as an AVAILABLE height
 * that number clips: the visit fitted a 470-tall world into `box.H` and, at a 1180x400 phone in
 * landscape, produced a 430px canvas inside 400px of `overflow: hidden` — about 15px lost off
 * the top and the bottom.
 *
 * Margins: a little breathing room horizontally, and a line for the HUD (the visit's strip sits
 * in the same band). The `Math.max(320, …)` floors that used to be here are gone: MIN_W is 360
 * and MIN_H is 430, so `clamp` below swallowed them whole and they never changed an answer —
 * but as an available box they would be a lie about a small window.
 */
export function availableBox(
  viewportW: number,
  viewportH: number,
): { W: number; H: number } {
  return {
    W: Math.max(1, viewportW - 16),
    H: Math.max(1, viewportH - 70),
  };
}

export function computeLayout(viewportW: number, viewportH: number): Layout {
  const avail = availableBox(viewportW, viewportH);

  const W = Math.round(clamp(avail.W, MIN_W, MAX_W));
  const H = Math.round(clamp(avail.H, MIN_H, MAX_H));

  // The plot COUNT comes from the local viewport; where those plots go is `plotPositions`.
  // Splitting the two is what lets a visit keep the second and reject the first.
  const inset = Math.min(135, W * 0.14);
  const usable = W - inset * 2;
  const plots = clamp(
    Math.floor(usable / MIN_PLOT_WIDTH) + 1,
    MIN_PLOTS,
    MAX_PLOTS,
  );

  return { W, H, soil: H - SOIL_BAND, plotXs: plotPositions(W, plots) };
}

/** Whether two layouts differ in any way that requires re-growing the garden. */
export function layoutChanged(a: Layout, b: Layout): boolean {
  return (
    a.W !== b.W ||
    a.H !== b.H ||
    a.soil !== b.soil ||
    a.plotXs.length !== b.plotXs.length ||
    a.plotXs.some((x, i) => Math.abs(x - b.plotXs[i]!) > 0.5)
  );
}
