import type { PetalShape, PetalSpec, Vec2 } from "../types";

/** Half-width profile along the petal, t in [0,1] from base to tip. */
function halfWidth(shape: PetalShape, t: number): number {
  const base = Math.sin(Math.PI * Math.pow(t, 0.75));
  switch (shape) {
    case "round":
      return base;
    case "pointed":
      return base * Math.pow(1 - t, 0.35) * 1.25;
    case "lobed":
      return base * (1 + 0.18 * Math.cos(6 * Math.PI * t));
    case "frilled":
      return base * (1 + 0.13 * Math.sin(14 * Math.PI * t));
  }
}

/** Symmetric petal outline, rotated by spec.angle and translated to spec.center. */
export function petalPath(spec: PetalSpec, samples = 24): Vec2[] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const place = (along: number, across: number): Vec2 => ({
    x: spec.center.x + along * cos - across * sin,
    y: spec.center.y + along * sin + across * cos,
  });

  const upper: Vec2[] = [];
  const lower: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const hw = (halfWidth(spec.shape, t) * spec.width) / 2;
    upper.push(place(t * spec.length, hw));
    lower.push(place(t * spec.length, -hw));
  }
  return upper.concat(lower.reverse());
}

const HUES = [350, 20, 320, 285, 250]; // crimson, coral, magenta, violet, blue

export function petalColor(
  hueClass: number,
  white: boolean,
  colorDepth: number,
): string {
  if (white) return `hsl(45 16% ${92 - 14 * colorDepth}%)`;
  const h = HUES[hueClass] ?? HUES[0]!;
  return `hsl(${h} ${70 - 10 * colorDepth}% ${62 - 26 * colorDepth}%)`;
}

/** Thin canvas wrapper. No logic worth testing. */
export function fillPetal(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  fill: string,
  stroke: string,
): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}
