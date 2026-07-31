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

// --- A replaced plant RECEDES rather than cutting to the background ----------------------
//
// The animation is only real if there is a window in which the plant is neither in the bed
// nor in the buffer. Asserting the end state alone would pass on the hard cut this replaced.
const before = await page.evaluate(() => window.__state());
if (before.empty >= 0 || before.occupied.length > 0) {
  // Take a seed, then plant it ON TOP of an occupied plot so something is displaced.
  const flowers = await page.evaluate(() => window.__blooms());
  if (flowers.length) {
    const box2 = await page.locator('#c').boundingBox();
    const size2 = await page.evaluate(() => window.__size());
    const toPg = (q) => ({ x: box2.x + (q.x * box2.width) / size2.w, y: box2.y + (q.y * box2.height) / size2.h });
    const f = toPg(flowers[0]);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);

    const occupied = (await page.evaluate(() => window.__state())).occupied[0];
    const slot = toPg(await page.evaluate(() => window.__traySlot(0)));
    const soil = await page.evaluate(() => window.__soil);
    const px = await page.evaluate((i) => window.__plotX(i), occupied);
    const drop = toPg({ x: px, y: soil - 25 });
    await page.mouse.move(slot.x, slot.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const midReceding = await page.evaluate(() => window.__receding());
    check('a replaced plant is in flight, not yet in the background',
      midReceding > 0, `receding ${midReceding}`);

    // Polls the CHEAP hook. `__state()` reads the whole background buffer back to report
    // coverage, and polling that once per frame starved the frame loop badly enough that the
    // recede never finished — asking whether it was done was what stopped it being done.
    await page.waitForFunction(() => window.__receding() === 0, undefined, { timeout: 8000 })
      .catch(() => {});
    const depthAfter = await page.evaluate(() => window.__forestDepth());
    const recedingAfter = await page.evaluate(() => window.__receding());
    check('...and lands in the background when it arrives',
      recedingAfter === 0 && depthAfter > before.forestDepth,
      `depth ${before.forestDepth} -> ${depthAfter}, receding ${recedingAfter}`);
  }
}

// --- The bed must run at a usable frame rate -----------------------------------------------
//
// §21 multiplied the flower count by roughly five and nothing downstream was rebuilt for it.
// Measured before the plant cache existed: 11 fps with ~150 blooms on screen, 67% of the paint
// budget in petals. Motion is worth nothing at 11 fps, so the floor is asserted here rather
// than left to be noticed by whoever opens the page next.
await page.evaluate(() => window.__seek(2400));
await page.waitForTimeout(1200);
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
    else res(n / ((performance.now() - t0) / 1000));
  };
  requestAnimationFrame(tick);
}));
const onScreen = await page.evaluate(() => window.__blooms().length);
check('the garden runs at a usable frame rate', fps > 30,
  `${fps.toFixed(1)} fps with ${onScreen} flowers on screen`);

check('no page errors', errors.length === 0, errors.join('; '));
await browser.close();
console.log(failures === 0 ? '\nthe garden is alive' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
