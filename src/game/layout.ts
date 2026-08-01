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

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export function computeLayout(viewportW: number, viewportH: number): Layout {
  // Margins: a little breathing room horizontally, and a line for the HUD.
  const availW = Math.max(320, viewportW - 16);
  const availH = Math.max(320, viewportH - 70);

  const W = Math.round(clamp(availW, MIN_W, MAX_W));
  const H = Math.round(clamp(availH, MIN_H, MAX_H));

  // Inset scales with width instead of staying at 135. A fixed inset on a 396-wide world
  // would eat two thirds of it, leaving the plots crushed into the middle.
  const inset = Math.min(135, W * 0.14);
  const usable = W - inset * 2;
  const plots = clamp(
    Math.floor(usable / MIN_PLOT_WIDTH) + 1,
    MIN_PLOTS,
    MAX_PLOTS,
  );

  const plotXs =
    plots === 1
      ? [W / 2]
      : Array.from(
          { length: plots },
          (_, i) => inset + (i / (plots - 1)) * usable,
        );

  return { W, H, soil: H - SOIL_BAND, plotXs };
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
