import { growPlant } from "../src/growth/sim";
import { fitPlant, paintPlant, paintStage } from "../src/render/stage";
import type { Phenotype } from "../src/types";

const W = 300;
const H = 340;

const BASE: Phenotype = {
  vigour: 0.55,
  droop: 0.15,
  phototropism: 0.55,
  stiffness: 0.35,
  branchiness: 0.55,
  baseWidth: 10,
  taper: 0.978,
  branchAngle: 0.5,
  branchWidthRatio: 0.62,
  doubled: false,
  petalShape: "round",
  hueClass: 0,
  white: false,
  bloomRadius: 22,
};

const CASES: { label: string; pheno: Phenotype }[] = [
  { label: "baseline single", pheno: BASE },
  { label: "compact", pheno: { ...BASE, vigour: 0.15, branchiness: 0.1 } },
  { label: "reaching", pheno: { ...BASE, vigour: 1.0, branchiness: 0.2 } },
  {
    label: "weeping",
    pheno: { ...BASE, droop: 1.0, phototropism: 0.1, stiffness: 0.15 },
  },
  { label: "bushy", pheno: { ...BASE, branchiness: 1.0, branchAngle: 0.7 } },
  {
    label: "doubled magenta",
    pheno: { ...BASE, doubled: true, hueClass: 2, bloomRadius: 18 },
  },
  { label: "white (W block)", pheno: { ...BASE, white: true, doubled: true } },
  {
    label: "pointed violet",
    pheno: { ...BASE, petalShape: "pointed", hueClass: 3 },
  },
  {
    label: "frilled blue",
    pheno: { ...BASE, petalShape: "frilled", hueClass: 4, doubled: true },
  },
];

const grid = document.getElementById("grid")!;

CASES.forEach((c, i) => {
  const fig = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = `${i + 1}. ${c.label}`;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  fig.append(canvas, cap);
  grid.append(fig);

  const ctx = canvas.getContext("2d")!;
  paintStage(ctx, W, H);
  const plant = growPlant(c.pheno, 1000 + i, { x: W / 2, y: H - 14 });
  // Fit before painting so no plant can carry its bloom off-canvas.
  const f = fitPlant(plant, W, H);
  ctx.save();
  ctx.translate(f.dx, f.dy);
  ctx.scale(f.scale, f.scale);
  paintPlant(ctx, plant);
  ctx.restore();
});

// Signals to the screenshot tool that every canvas has finished painting.
(window as unknown as { __lookdevReady: boolean }).__lookdevReady = true;
