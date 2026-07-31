/**
 * Pointer gestures, in one place.
 *
 * Every driver used to hand-roll `mouse.down(); mouse.up()`, and that was fine right up until
 * the game learned a gesture that depends on DURATION. Press-and-hold reinterprets any press
 * longer than 450ms as "read this plant" instead of "take a seed", and a driver has no control
 * over how long its own press takes — one measured 554ms. So a click silently became an
 * inspect, in whichever drivers happened to be slow that run, and the failures looked like
 * flaky planting rather than like a redefined gesture.
 *
 * This is the third time in this project that a fix landed in one file and the identical defect
 * survived in its neighbour. Sharing the gesture is the fix for the CLASS: when the game learns
 * another duration-sensitive move, there is exactly one place that has to know.
 */

/** Canvas-space -> page-space, and the gestures that use it. */
export function gestures(page, box, size) {
  const toPage = (p) => ({
    x: box.x + (p.x * box.width) / size.w,
    y: box.y + (p.y * box.height) / size.h,
  });

  /**
   * A short press. Guaranteed to be read as a click, never as a hold.
   *
   * Playwright cannot promise a press completes quickly, so the guarantee is made after the
   * fact: if a card opened, the press was long enough to count as a hold, and the gesture is
   * dismissed and retried rather than being reported as "the click did nothing".
   */
  async function tap(at) {
    const p = toPage(at);
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(90);
      const card = await page
        .evaluate(() => (window.__card ? window.__card() : null))
        .catch(() => null);
      if (card === null) return true;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(60);
    }
    return false;
  }

  /** A deliberate press-and-hold — the inspect gesture. */
  async function hold(at, ms = 700) {
    const p = toPage(at);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }

  /** A drag. Movement past the slop threshold cancels any pending hold, so this is safe. */
  async function drag(from, to, steps = 8) {
    const a = toPage(from);
    const b = toPage(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps });
    await page.mouse.up();
    await page.waitForTimeout(110);
  }

  return { toPage, tap, hold, drag };
}
