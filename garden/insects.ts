import { AMBIENT_MAX, CARRIER_SIT_TICKS } from "../src/game/pollinator";

/**
 * Insects: their positions, motion and drawing.
 *
 * Deliberately separate from `src/game/pollinator.ts`, which owns the RULES. This file cannot be
 * unit-tested without a canvas and the rules can, so the split follows the same line `hit.ts`
 * already draws through this codebase — pure decisions on one side, pixels on the other.
 *
 * One entity, not two. An ambient insect is simply a carrier with no pollen, so there is a
 * single lifecycle rather than two that drift apart the first time one of them changes.
 */
export type Insect = {
  x: number;
  y: number;
  vx: number;
  /** Serialized genome, or null for an ambient insect that is only passing through. */
  pollen: string | null;
  /** Which plot's flower it settled on. `-1` for ambient. */
  plotIndex: number;
  /** Tick at which it gives up and leaves. */
  sitUntil: number;
};

let live: Insect[] = [];
let expired: Insect[] = [];

export const insects = (): Insect[] => live;

/** Drop everything — used when the garden is wiped, so insects do not outlive their bed. */
export function clearInsects(): void {
  live = [];
  expired = [];
}

export function spawnAmbient(w: number, h: number, rand: () => number): void {
  if (live.filter((i) => !i.pollen).length >= AMBIENT_MAX) return;
  const fromLeft = rand() < 0.5;
  live.push({
    x: fromLeft ? -20 : w + 20,
    y: h * (0.25 + rand() * 0.4),
    vx: (fromLeft ? 1 : -1) * (0.3 + rand() * 0.4),
    pollen: null,
    plotIndex: -1,
    sitUntil: Number.MAX_SAFE_INTEGER,
  });
}

export function spawnCarrier(
  pollen: string,
  plotIndex: number,
  at: { x: number; y: number },
  now: number,
): Insect {
  const bug: Insect = {
    x: at.x,
    y: at.y,
    vx: 0,
    pollen,
    plotIndex,
    sitUntil: now + CARRIER_SIT_TICKS,
  };
  live.push(bug);
  return bug;
}

/** Remove one insect — used when its pollen has been taken. */
export function removeInsect(i: Insect): void {
  live = live.filter((x) => x !== i);
}

/**
 * Advance motion and retire anything finished.
 *
 * Carriers that time out move to `expired` rather than simply vanishing, because whether one
 * pollinated on its way out is a decision the caller has to make exactly once, on the frame it
 * leaves. Dropping them silently here would make that decision unreachable.
 */
export function updateInsects(now: number, w: number): Insect[] {
  const gone: Insect[] = [];
  live = live.filter((i) => {
    if (i.pollen) {
      if (now >= i.sitUntil) {
        gone.push(i);
        return false;
      }
      return true;
    }
    i.x += i.vx;
    return i.x > -40 && i.x < w + 40;
  });
  expired.push(...gone);
  return live;
}

/** Carriers that left this frame. Cleared on read, so a departure resolves once. */
export function takeExpired(): Insect[] {
  const out = expired;
  expired = [];
  return out;
}

/**
 * Two wings and a body, in the ink language the rest of the game uses.
 *
 * A carrier gets a filled abdomen so it reads as different from an ambient one without a label.
 * The label exists too, in the mirror, for the people who cannot see any of this.
 */
export function drawInsects(ctx: CanvasRenderingContext2D, now: number): void {
  for (const i of live) {
    ctx.save();
    ctx.translate(i.x, i.y);
    ctx.strokeStyle = "rgba(255,246,224,0.8)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.2, 2, 0, 0, Math.PI * 2);
    if (i.pollen) {
      ctx.fillStyle = "rgba(255,226,150,0.85)";
      ctx.fill();
    }
    ctx.stroke();
    // Driven by the clock rather than by x, so a carrier sitting still still beats its wings.
    const flap = Math.sin(now * 0.5 + i.x) * 2.2;
    ctx.beginPath();
    ctx.moveTo(-1, -1);
    ctx.quadraticCurveTo(-4, -4 - flap, -7, -1.5);
    ctx.moveTo(1, -1);
    ctx.quadraticCurveTo(4, -4 - flap, 7, -1.5);
    ctx.stroke();
    ctx.restore();
  }
}
