/**
 * Does the garden actually MOVE?
 *
 * A still screenshot cannot answer this, and neither can a unit test: `motion.ts` is pure and
 * fully tested, and a plant would still stand perfectly still if the transform were never
 * applied. The only check that discriminates is two frames of the real canvas, some time
 * apart, with nothing touched in between.
 *
 * Paired with a control that the plant is not simply sliding around: its BASE must not move,
 * or the garden is not swaying, it is drifting out of its own soil.
 */
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });
await page.evaluate(() => window.__seek(900));
await page.waitForTimeout(400);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Fraction of canvas pixels that differ between two captures, and where they differ. */
const sample = () => page.evaluate(() => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  // Downsample to keep the payload small; we only need a change signal, not an image.
  const out = [];
  for (let i = 0; i < d.length; i += 4 * 37) out.push(d[i], d[i + 1], d[i + 2], d[i + 3]);
  return out;
});

const a = await sample();
await page.waitForTimeout(1100);
const b = await sample();
let diff = 0;
for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 6) diff++;
const frac = diff / a.length;
check('the scene changes between frames with nothing touched', frac > 0.002,
  `${(frac * 100).toFixed(2)}% of sampled channels moved`);

// CONTROL: a plant's base must stay exactly where it was planted. The whole scene moving is
// indistinguishable from the whole scene sliding, until you check the anchor.
const baseDrift = await page.evaluate(async () => {
  const at = () => window.__stemAt(window.__state().occupied[0]);
  const before = at();
  await new Promise((r) => setTimeout(r, 900));
  const after = at();
  return Math.hypot(after.x - before.x, after.y - before.y);
});
check('CONTROL: the plant geometry itself never moves', baseDrift === 0,
  `base drifted ${baseDrift}px`);

// CONTROL: a sampled region BELOW the soil is static — if the whole canvas were being
// redrawn differently each frame, the diff above would be meaningless.
const soilChanged = await page.evaluate(async () => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const strip = () => Array.from(g.getImageData(0, c.height - 30, c.width, 20).data);
  const first = strip();
  await new Promise((r) => setTimeout(r, 900));
  const second = strip();
  let n = 0;
  for (let i = 0; i < first.length; i++) if (Math.abs(first[i] - second[i]) > 6) n++;
  return n / first.length;
});
check('CONTROL: the soil band stays still', soilChanged < 0.001,
  `${(soilChanged * 100).toFixed(3)}% of the soil moved`);

check('no page errors', errors.length === 0, errors.join('; '));
await browser.close();
console.log(failures === 0 ? '\nthe garden is alive' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
