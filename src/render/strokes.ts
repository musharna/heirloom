import type { StrokeSegment, Vec2 } from "../types";

/** Group a flat segment list into per-tip chains, preserving emission order. */
export function groupChains(segs: StrokeSegment[]): StrokeSegment[][] {
  const byChain = new Map<number, StrokeSegment[]>();
  for (const s of segs) {
    const arr = byChain.get(s.chain);
    if (arr) arr.push(s);
    else byChain.set(s.chain, [s]);
  }
  return [...byChain.values()];
}

/**
 * Catmull-Rom densification of a chain's centreline, lerping width along the way.
 * The curve is emergent from the growth path — no control points are authored.
 */
export function smoothChain(
  chain: StrokeSegment[],
  subdiv = 3,
): StrokeSegment[] {
  if (chain.length < 2) return chain.slice();

  // Centreline points: every segment start, then the final end.
  const pts: Vec2[] = chain.map((s) => ({ x: s.x0, y: s.y0 }));
  const lastSeg = chain[chain.length - 1]!;
  pts.push({ x: lastSeg.x1, y: lastSeg.y1 });
  const widths = chain.map((s) => s.w0);
  widths.push(lastSeg.w1);

  const at = (i: number): Vec2 =>
    pts[Math.min(pts.length - 1, Math.max(0, i))]!;
  const wAt = (i: number): number =>
    widths[Math.min(widths.length - 1, Math.max(0, i))]!;

  const dense: { p: Vec2; w: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let j = 0; j < subdiv; j++) {
      const t = j / subdiv;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push({
        p: {
          x:
            0.5 *
            (2 * p1.x +
              (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y:
            0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        },
        w: wAt(i) + (wAt(i + 1) - wAt(i)) * t,
      });
    }
  }
  dense.push({ p: at(pts.length - 1), w: wAt(widths.length - 1) });

  const out: StrokeSegment[] = [];
  const proto = chain[0]!;
  for (let i = 0; i < dense.length - 1; i++) {
    const a = dense[i]!;
    const b = dense[i + 1]!;
    out.push({
      x0: a.p.x,
      y0: a.p.y,
      x1: b.p.x,
      y1: b.p.y,
      w0: a.w,
      w1: b.w,
      depth: proto.depth,
      tick: chain[Math.min(chain.length - 1, Math.floor(i / subdiv))]!.tick,
      chain: proto.chain,
    });
  }
  return out;
}

/**
 * Direction the light comes from, in screen space (up and slightly left).
 *
 * One shared vector so every shaded surface agrees. Lighting each element from its own local
 * frame instead is what makes procedural art read as a collection of decals: a stem lit from
 * its own left and a leaf lit from its own left are lit from different real directions the
 * moment either one rotates.
 */
export const LIGHT: Vec2 = { x: -0.45, y: -0.89 };

export type OutlineOpts = {
  /** Fraction of the full width to draw. 1 = the silhouette itself. */
  widthScale?: number;
  /**
   * Shift the strip toward the light, as a fraction of local width. The shift follows the
   * LIT side as the stroke curves, rather than a fixed screen direction — a highlight that
   * stayed on the geometric left would cross to the shadow side on a stem that bends over.
   */
  towardLight?: number;
};

/** Variable-width outline polygon: left side forward, right side back. */
export function buildOutline(
  chain: StrokeSegment[],
  opts: OutlineOpts = {},
): Vec2[] {
  if (chain.length === 0) return [];
  const widthScale = opts.widthScale ?? 1;
  const towardLight = opts.towardLight ?? 0;
  const left: Vec2[] = [];
  const right: Vec2[] = [];

  const push = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    w: number,
  ): void => {
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    // How much this normal faces the light: +1 fully lit, -1 fully away.
    const facing = nx * LIGHT.x + ny * LIGHT.y;
    const shift = towardLight * w * facing;
    const cx = x + nx * shift;
    const cy = y + ny * shift;
    const half = (w * widthScale) / 2;
    left.push({ x: cx + nx * half, y: cy + ny * half });
    right.push({ x: cx - nx * half, y: cy - ny * half });
  };

  for (const s of chain) push(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, s.w0);
  const last = chain[chain.length - 1]!;
  push(last.x1, last.y1, last.x1 - last.x0, last.y1 - last.y0, last.w1);

  return left.concat(right.reverse());
}

/** Thin canvas wrapper. No logic worth testing. */
export function fillOutline(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  color: string,
): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
