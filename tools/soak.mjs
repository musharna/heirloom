/**
 * A long session, compressed.
 *
 * Nothing in this project has ever been run for more than a few minutes. Every driver builds a
 * garden of five or six plants and stops, which means every unbounded thing in the codebase has
 * been measured exactly once, at zero. This plays hundreds of rounds and watches what grows
 * that should not.
 *
 *   SOAK_ROUNDS=200 node tools/soak.mjs
 *
 * It reports rather than asserts by default — the point is to find out what happens, and a
 * threshold invented before the first measurement is a guess dressed as a check. Pass
 * SOAK_ASSERT=1 once the numbers are known.
 */
import { chromium } from 'playwright';
import { gestures } from './gestures.mjs';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
const ROUNDS = Number(process.env.SOAK_ROUNDS ?? 150);
const ASSERT = process.env.SOAK_ASSERT === '1';

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size());
const g = gestures(page, box, size);

const client = await page.context().newCDPSession(page);

async function sample() {
  const m = await client.send('Runtime.getHeapUsage').catch(() => null);
  return page.evaluate((heap) => {
    // Deliberately NOT `__state()`: it reports background coverage, which means reading the
    // whole buffer back with getImageData. Measured at up to 11.9 SECONDS per sample here,
    // which is longer than the rounds it was supposed to be measuring.
    const s = { retired: window.__state ? -1 : -1, forestDepth: window.__forestDepth() };
    const raw = localStorage.getItem('heirloom.garden.v1') ?? '';
    let replay = -1;
    let notebook = -1;
    try {
      const j = JSON.parse(raw);
      replay = (j.replay ?? []).length;
      notebook = (j.notebook ?? []).length;
    } catch {
      /* a partial write mid-sample is not interesting */
    }
    return {
      retired: window.__retiredTotal(),
      forestDepth: s.forestDepth,
      saveBytes: raw.length,
      replay,
      notebook,
      heapMB: heap ? heap.usedSize / 1e6 : -1,
    };
  }, m);
}

/** Frames per second, measured over a second of real time. */
const fps = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else res(n / ((performance.now() - t0) / 1000));
        };
        requestAnimationFrame(tick);
      }),
  );

/**
 * One round: take a seed from a flower, plant it over a plot.
 *
 * Every lookup the round needs comes back in ONE evaluate. The first version made ten
 * round-trips per round and the soak spent its entire budget on IPC rather than on the thing
 * being measured — a hundred rounds did not finish in ten minutes.
 */
async function round() {
  const plan = await page.evaluate(() => {
    const b = window.__blooms();
    if (!b.length) return null;
    // NOT `__state()`: it reads the whole background buffer back to report coverage, and
    // calling that once per round is what turned a hundred rounds into twenty minutes with
    // nothing to show for it.
    const s = window.__plots();
    const f = b[Math.floor(b.length / 2)];
    const target = s.empty >= 0 ? s.empty : s.occupied[0];
    if (target === undefined) return null;
    return {
      flower: { x: f.x, y: f.y },
      slot: window.__traySlot(0),
      drop: { x: window.__plotX(target), y: window.__soil - 25 },
    };
  });
  if (!plan) return false;

  await g.tap(plan.flower);
  await g.drag(plan.slot, plan.drop, 3);
  // Jump the clock rather than waiting: a real long session is hours, and everything being
  // watched here grows per ROUND, not per second.
  await page.evaluate(() => window.__seek(window.__now() + 400));
  return true;
}

console.log(`soaking ${ROUNDS} rounds against ${URL}\n`);
const first = await sample();
console.log(
  `round   retired  depth   save(B)  replay  notebook   heap(MB)`,
);
const report = (i, s, extra = '') =>
  console.log(
    `${String(i).padStart(5)}   ${String(s.retired).padStart(7)}  ${String(s.forestDepth).padStart(5)}  ${String(s.saveBytes).padStart(8)}  ${String(s.replay).padStart(6)}  ${String(s.notebook).padStart(8)}   ${s.heapMB.toFixed(1).padStart(8)}${extra}`,
  );
report(0, first);

const fpsStart = await fps();
let last = first;
let roundT0 = Date.now();
let midSave = 0;
for (let i = 1; i <= ROUNDS; i++) {
  if (!(await round())) {
    console.log(`stopped early at round ${i}: no flowers to work with`);
    break;
  }
  if (i === 40) midSave = (await sample()).saveBytes;
  if (i % 10 === 0) {
    const roundsMs = Date.now() - roundT0;
    const sT0 = Date.now();
    last = await sample();
    const sampleMs = Date.now() - sT0;
    report(i, last, `   ${(roundsMs / 10).toFixed(0)}ms/round  sample ${sampleMs}ms`);
    roundT0 = Date.now();
  }
}

// Let everything settle, then measure again — a leak that is really just work-in-flight
// disappears here, and one that is real does not.
await page.waitForTimeout(1500);
const settled = await sample();
const fpsEnd = await fps();

// A relayout re-grows the whole retirement history. It is the one operation whose cost is a
// function of how long the session has been going, so it is the one worth timing at the end.
const relayoutMs = await page.evaluate(async () => {
  const t0 = performance.now();
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => requestAnimationFrame(r));
  return performance.now() - t0;
});
await page.setViewportSize({ width: 900, height: 620 });
const rotateT0 = Date.now();
await page.waitForTimeout(50);
const rotateMs = Date.now() - rotateT0;

console.log(`\nsettled:`);
report('end', settled);
console.log(`\nfps        ${fpsStart.toFixed(1)} -> ${fpsEnd.toFixed(1)}`);
console.log(`heap       ${first.heapMB.toFixed(1)}MB -> ${settled.heapMB.toFixed(1)}MB`);
console.log(`save       ${first.saveBytes}B -> ${settled.saveBytes}B  (mid-play ${midSave}B)`);
console.log(`same-size resize ${relayoutMs.toFixed(1)}ms · real reshape ${rotateMs}ms`);
console.log(errors.length ? `\npage errors: ${errors.slice(0, 3).join(' | ')}` : '\nno page errors');

let failures = 0;
if (ASSERT) {
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
    if (!ok) failures++;
  };
  check('the save stays bounded', settled.saveBytes < 60_000, `${settled.saveBytes} bytes`);
  // The one this soak exists for. A trailing debounce with no ceiling never fires while the
  // player keeps playing, so a long session wrote NOTHING until the driver stopped.
  check('the garden saves DURING play, not only once it stops',
    midSave > 0, `${midSave} bytes written while still playing`);
  check('the frame rate holds up', fpsEnd > 30, `${fpsEnd.toFixed(1)} fps`);
  check('the heap does not run away', settled.heapMB < 260, `${settled.heapMB.toFixed(1)} MB`);
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none');
}

await browser.close();
process.exit(failures ? 1 : 0);
