import { parseGenome } from "../genome/serialize";
import { grow } from "../game/garden";
import { paintPlant, plantBounds, type Bounds, type Fit } from "./stage";

/**
 * Thumbnails of retired plants, for the drawer.
 *
 * The drawer lists genomes, and a genome is fourteen base64url characters — useless for
 * choosing which flower to bring back. So each entry shows the plant itself. Growth is a pure
 * function of the genome (§6), which is what makes this honest rather than decorative: the
 * thumbnail is not something *like* what was retired, it is exactly the plant that was.
 */

/**
 * Fit a plant's bounding box into a thumbnail, preserving aspect.
 *
 * Pure, and kept separate from the painting so it can be tested without a canvas.
 *
 * The degenerate case is not hypothetical: `plantBounds` returns all zeroes for a plant with no
 * geometry, and a canvas transform scaled by 0 is rejected outright by some engines — the same
 * failure `paintPlantCached` guards with its null-bounds fallback. Clamping the extents at 1
 * makes that unrepresentable rather than merely unlikely.
 */
export function fitPlant(b: Bounds, w: number, h: number, pad = 6): Fit {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return {
    scale,
    // Subtracting the origin matters as much as centring: plants grow around y=0 at the soil
    // line, so minY is negative and ignoring it would push the plant off the top of the frame.
    dx: (w - bw * scale) / 2 - b.minX * scale,
    dy: (h - bh * scale) / 2 - b.minY * scale,
  };
}

/**
 * Paint the plant a genome code grows into, into a thumbnail canvas.
 *
 * Returns false rather than throwing on an unreadable code: a drawer holding one corrupt entry
 * should still show the other 199.
 */
export function paintThumb(canvas: HTMLCanvasElement, code: string): boolean {
  const parsed = parseGenome(code);
  if (!parsed.ok) return false;

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const planting = grow(parsed.genome, 0, 0);
  const fit = fitPlant(
    plantBounds(planting.plant),
    canvas.width,
    canvas.height,
  );

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(fit.dx, fit.dy);
  ctx.scale(fit.scale, fit.scale);
  // Fully grown, every flower open. A thumbnail of a half-grown plant would misrepresent what
  // the player is being offered back.
  paintPlant(ctx, planting.plant, planting.maxTick);
  ctx.restore();
  return true;
}
