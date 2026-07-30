import { mulberry32, angleDelta } from "../rng";
import { layoutBloom } from "./bloom";
import type {
  Phenotype,
  Plant,
  StrokeSegment,
  Tip,
  Vec2,
  Bloom,
} from "../types";

const MIN_WIDTH = 0.6;
const MAX_TIPS = 400;
const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

export function growPlant(pheno: Phenotype, seed: number, origin: Vec2): Plant {
  const rand = mulberry32(seed);
  const segments: StrokeSegment[] = [];
  const blooms: Bloom[] = [];

  const maxTicks = Math.round(40 + 60 * pheno.vigour);
  const stepLen = 3 + 5 * pheno.vigour;
  let nextId = 0;

  let tips: Tip[] = [
    {
      id: nextId++,
      pos: { ...origin },
      dir: UP,
      width: pheno.baseWidth,
      age: 0,
      depth: 0,
      vigourLeft: maxTicks,
      alive: true,
    },
  ];

  for (let tick = 0; tick < maxTicks; tick++) {
    if (tips.length === 0) break;
    const spawned: Tip[] = [];

    for (const tip of tips) {
      // 1. Tropisms — gravitropism pulls toward DOWN, phototropism toward UP.
      //    They oppose each other, which is what makes droop read as a habit.
      const turn =
        pheno.droop * 0.06 * angleDelta(tip.dir, DOWN) +
        pheno.phototropism * 0.05 * angleDelta(tip.dir, UP) +
        (rand() - 0.5) * 0.25;
      tip.dir += turn * (1 - pheno.stiffness * 0.7);

      // 2. Step
      const len = stepLen * Math.max(0.35, 1 - 0.06 * tip.depth);
      const nx = tip.pos.x + Math.cos(tip.dir) * len;
      const ny = tip.pos.y + Math.sin(tip.dir) * len;

      // 3. Taper
      const w1 = tip.width * pheno.taper;

      segments.push({
        x0: tip.pos.x,
        y0: tip.pos.y,
        x1: nx,
        y1: ny,
        w0: tip.width,
        w1,
        depth: tip.depth,
        tick,
        chain: tip.id,
      });

      tip.pos = { x: nx, y: ny };
      tip.width = w1;
      tip.age++;
      tip.vigourLeft--;

      // 4. Branch
      if (
        tips.length + spawned.length < MAX_TIPS &&
        tip.age > 3 &&
        rand() < pheno.branchiness * 0.08
      ) {
        const side = rand() < 0.5 ? 1 : -1;
        spawned.push({
          id: nextId++,
          pos: { ...tip.pos },
          dir: tip.dir + side * pheno.branchAngle,
          width: tip.width * pheno.branchWidthRatio,
          age: 0,
          depth: tip.depth + 1,
          vigourLeft: Math.max(1, Math.round(tip.vigourLeft * 0.7)),
          alive: true,
        });
      }

      // 5. Terminate -> bloom
      if (tip.width < MIN_WIDTH || tip.vigourLeft <= 0) {
        tip.alive = false;
        blooms.push(layoutBloom(pheno, tip.pos, tip.dir, rand));
      }
    }

    tips = tips.filter((t) => t.alive).concat(spawned);
  }

  // Any tip still alive when the clock runs out still blooms.
  for (const tip of tips)
    blooms.push(layoutBloom(pheno, tip.pos, tip.dir, rand));

  return { segments, blooms };
}
