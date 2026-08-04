/**
 * Does the garden's clock measure TIME, or does it measure FRAMES?
 *
 * `test/motion.test.ts` proves `ticksElapsed` is a function of elapsed milliseconds. It cannot
 * prove the frame loop calls it correctly — a delta computed against the wrong timestamp, an
 * advance left at the bottom of the frame, or a loop that never receives the rAF argument would
 * all pass every unit test in that file and still leave growth running at whatever speed the
 * renderer happens to manage. Only the real loop, in a real browser, discriminates.
 *
 * The defect this guards against was live until 2026-08-04: `now += SPEED` once per animation
 * frame, so a plant took ~8.5s to grow on a machine that ran growth at 6.5fps and would have
 * taken ~1.65s on one that held 60fps.
 *
 * TWO assertions, and they are portable for different reasons:
 *
 *  1. The clock keeps its STATED RATE in ticks per second. This is the portable one, and it is
 *     portable precisely because a time-based clock has no opinion about frame rate: 17 ticks a
 *     second is 17 ticks a second on a two-core runner. It is also the discriminating one — a
 *     frame-counted clock reads 84 ticks/s at 60fps and 28 at 20fps, and only coincides with
 *     the truth on a machine sitting at exactly 12.14fps.
 *  2. The rate SURVIVES A CHANGE OF FRAME RATE, under CPU throttling. Stronger, but only
 *     meaningful while the throttled frames stay inside `MAX_FRAME_MS` — past the cap the clock
 *     falls behind ON PURPOSE and a failure would not be a defect. The throttle is therefore
 *     chosen from the machine's own measured frame rate, and if no usable throttle exists the
 *     comparison says so out loud rather than passing quietly.
 *
 * Measured in the SETTLED bed, not during growth, and that is deliberate: growth already runs
 * at ~6.5fps here, so there is no headroom under the cap to throttle into.
 */
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
/** Ticks per second the growth clock should keep, from `GROWTH_TICKS_PER_SECOND`. */
const EXPECTED = 17;
/** How far the measured rate may sit from the expected one, and from itself across rates. */
const TOLERANCE = 0.15;
/** From `MAX_FRAME_MS`. Past this the clock is capped deliberately and comparison is invalid. */
const CAP_MS = 250;
/** The throttled frame rate must differ from the free one by at least this factor to discriminate. */
const MIN_SEPARATION = 2;

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const skip = (label, why) => console.log(`SKIP  ${label} — ${why}`);

// Settle the bed so every plant paints from its cache and frames stay far inside the cap.
await page.evaluate(() => window.__seek(900));
await page.waitForTimeout(500);

/** Growth ticks per second, and the frame rate that produced them, over one window. */
const sample = (ms) => page.evaluate((ms) => new Promise((res) => {
  const t0 = performance.now();
  const c0 = window.__now();
  let frames = 0;
  const tick = () => {
    frames++;
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else {
      const seconds = (performance.now() - t0) / 1000;
      res({ ticksPerSecond: (window.__now() - c0) / seconds, fps: frames / seconds });
    }
  };
  requestAnimationFrame(tick);
}), ms);

const cdp = await page.context().newCDPSession(page);
const fast = await sample(3000);

// ASSERTION 1 — the portable one. Runs on every machine, gates on every machine.
{
  const off = Math.abs(fast.ticksPerSecond - EXPECTED) / EXPECTED;
  check(
    'the growth clock keeps its stated rate in ticks per SECOND',
    off < TOLERANCE,
    `${fast.ticksPerSecond.toFixed(2)} ticks/s against ${EXPECTED}, at ${fast.fps.toFixed(1)} fps`,
  );
}

// ASSERTION 2 — the stronger one, where the machine has room for it.
//
// The throttle is SEARCHED FOR, not computed. Predicting it from the free frame rate does not
// work and was tried: a settled bed spends most of a 16ms frame waiting on the compositor
// rather than running script, so CPU throttling does not scale frame time linearly. 4x took
// 59fps to 37, and 5x took 60fps to 34 — both far short of the separation the comparison needs,
// and both predicted to land near the target. Probe cheaply, then measure properly at whatever
// actually worked.
const LADDER = [4, 8, 12, 20];
let chosen = null;
for (const rate of LADDER) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.waitForTimeout(250);
  const probe = await sample(700);
  const frameMs = 1000 / probe.fps;
  console.log(
    `      probe ${String(rate).padStart(2)}x: ${probe.fps.toFixed(1)} fps, ${frameMs.toFixed(0)}ms/frame`,
  );
  if (frameMs >= CAP_MS) break; // past the cap; nothing slower will help
  if (probe.fps < fast.fps / MIN_SEPARATION) {
    chosen = rate;
    break;
  }
}

if (chosen === null) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  skip(
    'the growth clock survives a change of frame rate',
    `no throttle on this machine both separates the frame rates and stays inside the ${CAP_MS}ms ` +
      `cap — assertion 1 above still gates, and it is the one that discriminates`,
  );
} else {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: chosen });
  await page.waitForTimeout(300);
  const slow = await sample(3000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // CONTROLS FIRST, and re-checked at the full sample length rather than trusted from the
  // probe. This assertion compares two frame rates, so if the throttle did not hold there are
  // not two frame rates, and the comparison passes on any clock at all — including the
  // frame-counted one it exists to catch.
  const separated = slow.fps < fast.fps / MIN_SEPARATION;
  const slowFrameMs = 1000 / slow.fps;
  const insideCap = slowFrameMs < CAP_MS;

  check(
    'CONTROL: the throttle actually changed the frame rate',
    separated,
    `${fast.fps.toFixed(1)} fps free vs ${slow.fps.toFixed(1)} fps at ${chosen}x`,
  );
  check(
    'CONTROL: throttled frames stay inside the frame cap',
    insideCap,
    `${slowFrameMs.toFixed(0)}ms per frame against a ${CAP_MS}ms cap`,
  );

  if (separated && insideCap) {
    const drift = Math.abs(slow.ticksPerSecond - fast.ticksPerSecond) / fast.ticksPerSecond;
    check(
      'the growth clock runs at the same rate at both frame rates',
      drift < TOLERANCE,
      `${fast.ticksPerSecond.toFixed(2)} vs ${slow.ticksPerSecond.toFixed(2)} ticks/s, ` +
        `${(drift * 100).toFixed(1)}% apart`,
    );
  } else {
    skip(
      'the growth clock runs at the same rate at both frame rates',
      'its controls did not hold at full sample length, so a pass would mean nothing',
    );
  }
}

check('no page errors', errors.length === 0, errors.join('; '));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall clock checks passed');
process.exit(failures ? 1 : 0);
