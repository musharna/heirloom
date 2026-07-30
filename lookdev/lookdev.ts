import { growPlant } from "../src/growth/sim";
import {
  fitPlant,
  paintPlant,
  paintStage,
  soilLine,
} from "../src/render/stage";
import type { Phenotype } from "../src/types";

const SEED = 20260729;

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
  branchWidthRatio: 0.72,
  doubled: false,
  petalShape: "round",
  hueClass: 0,
  white: false,
  bloomRadius: 22,
};

// EXACTLY ONE axis differs from BASE per panel. The previous sheet changed hue and
// bloomRadius together in one panel, which made an unlabelled size difference look like a
// scrambled petal-shape gene to a reviewer.
const CASES: { label: string; pheno: Phenotype }[] = [
  { label: "baseline", pheno: BASE },
  { label: "compact (low vigour)", pheno: { ...BASE, vigour: 0.15 } },
  { label: "reaching (max vigour)", pheno: { ...BASE, vigour: 1.0 } },
  // droop ONLY. Also cutting phototropism removed the shoot's upward drive entirely, so
  // it never rose and read as a stub — and it violated this sheet's one-axis-per-panel rule.
  { label: "weeping (max droop)", pheno: { ...BASE, droop: 1.0 } },
  { label: "bushy (max branching)", pheno: { ...BASE, branchiness: 1.0 } },
  { label: "doubled", pheno: { ...BASE, doubled: true } },
  { label: "white (W block)", pheno: { ...BASE, white: true } },
  { label: "petal: pointed", pheno: { ...BASE, petalShape: "pointed" } },
  { label: "petal: lobed", pheno: { ...BASE, petalShape: "lobed" } },
  { label: "petal: frilled", pheno: { ...BASE, petalShape: "frilled" } },
  { label: "hue: violet", pheno: { ...BASE, hueClass: 3 } },
  { label: "hue: blue", pheno: { ...BASE, hueClass: 4 } },
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
  // ONE seed for every panel. With a per-panel seed each plant had a different skeleton,
  // so a petal-shape allele could not be compared against its own baseline — the whole
  // plant changed alongside it. A shared seed isolates the phenotype as the only variable.
  const plant = growPlant(c.pheno, SEED, { x: W / 2, y: soilLine(H) });
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
