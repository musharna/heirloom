/**
 * THE SHARE BUTTON ITSELF — the code path no other driver touches.
 *
 * `drive-visit.mjs` gets its garden code from `window.__gardenCode()`, which is the postcard and
 * nothing else. Everything between that string and a link in someone's chat window — the path
 * rewrite, the clipboard, and what the player is shown when the clipboard refuses — was
 * exercised by no test at all, in either direction. Two defects lived there:
 *
 *   - The path rewrite was `location.pathname.replace(/garden\/$/, "visit/")`, which misses the
 *     `…/garden/index.html` form GitHub Pages also serves. A `replace` that matches nothing
 *     returns its input, so the copied link kept the GARDEN path with `#garden=` on the end.
 *     Neither `#g=` nor `#new` matches that, so the recipient opened the link and saw their own
 *     garden — no error, no clue, the exact failure this feature exists to prevent.
 *   - When the clipboard refused, the ~1000-character URL was folded into `#hint`, which is
 *     styled `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. The player saw
 *     one ellipsised line and had no way to recover the link.
 *
 * So this drives the real button, on both URL forms, and FOLLOWS the link it produces. A check
 * that stopped at "the copied string contains /visit/" would not have caught the second half of
 * the first defect, which is that the wrong link still opens a perfectly good garden.
 */
import { chromium } from "playwright";

const BASE = process.env.GARDEN_URL ?? "http://localhost:5173/garden/";
const browser = await chromium.launch();

let failures = 0;
function check(label, ok, detail = "") {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failures++;
}

const errors = [];
const watch = (page) => page.on("pageerror", (e) => errors.push(e.message));

/**
 * A garden with something in it, at whichever URL form was asked for.
 *
 * The clock is run forward so the bed is planted: a postcard of nine bare plots is a legitimate
 * garden but it cannot tell two gardens apart, which is what the checks below need it for.
 */
async function openGarden(context, url) {
  const page = await context.newPage();
  watch(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  const at = (await page.evaluate(() => window.__now())) + 100000;
  await page.evaluate((t) => window.__seek(t), at);
  await page.waitForFunction((t) => window.__now() >= t, at, { timeout: 15000 });
  return page;
}

/** Open the drawer and press the real button. The drawer holds it; it is not on screen until. */
async function pressShare(page) {
  await page.click("#drawer-tab");
  await page.waitForSelector("#share-garden", { state: "visible" });
  await page.click("#share-garden");
}

const hint = (page) => page.evaluate(() => window.__hint());

// ── BOTH URL FORMS ───────────────────────────────────────────────────────────────────────────
// `…/garden/` and `…/garden/index.html` are the same page: a host may serve either, and a
// bookmark or a typed URL is as likely to be the second. Both must produce a link to the VISIT
// page, and the visit must open the sender's garden rather than the follower's own.
for (const [label, url] of [
  ["the trailing-slash form", BASE],
  ["the index.html form", `${BASE}index.html`],
]) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await openGarden(context, url);
  const senderPlots = await page.evaluate(() => window.__codes().plots);
  await pressShare(page);

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(
    `${label}: the copied link points at the VISIT page`,
    copied.includes("/visit/") && !/\/garden\/[^#]*#/.test(copied),
    copied.slice(0, 90) + "…",
  );
  check(
    `${label}: and carries a garden`,
    copied.includes("#garden="),
    `${copied.length} chars`,
  );

  // FOLLOW IT. The failure this replaces was a link that opened a perfectly good garden — the
  // WRONG one — so "the string looks right" is not the assertion. A second context, because a
  // follower who happens to share the sender's localStorage cannot tell the two apart.
  const follower = await browser.newContext({
    viewport: { width: 800, height: 620 },
  });
  const b = await follower.newPage();
  watch(b);
  await b.goto(BASE, { waitUntil: "networkidle" });
  await b.evaluate(() => localStorage.clear());
  await b.reload({ waitUntil: "networkidle" });
  await b.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  const ownPlots = await b.evaluate(() => window.__codes().plots);

  await b.goto("about:blank");
  await b.goto(copied, { waitUntil: "networkidle" });
  const onVisitPage = await b.evaluate(
    () => window.__visitReady === true || window.__ready === true,
  );
  const shown = await b.evaluate(() =>
    window.__visitPlots ? window.__visitPlots() : window.__codes().plots,
  );
  check(
    `${label}: CONTROL: the link opened something`,
    onVisitPage,
    b.url().slice(0, 90),
  );
  check(
    `${label}: CONTROL: the follower had a garden of their own to be confused with`,
    JSON.stringify(ownPlots) !== JSON.stringify(senderPlots),
    `${ownPlots.length} plots vs the sender's ${senderPlots.length}`,
  );
  check(
    `${label}: the follower sees the SENDER's garden, not their own`,
    JSON.stringify(shown) === JSON.stringify(senderPlots),
    `${JSON.stringify(shown).slice(0, 70)}… vs sender ${JSON.stringify(senderPlots).slice(0, 70)}…`,
  );

  await follower.close();
  await context.close();
}

// ── WHEN THE CLIPBOARD REFUSES ───────────────────────────────────────────────────────────────
// Non-secure context, permission denied, a browser that has no clipboard API at all: all real,
// and all end here. What the player must NOT get is the link squeezed into a one-line
// ellipsised hint, which is what shipped — the pattern was borrowed from the tray's share, whose
// payload is 14 characters against this one's ~1000.
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript(() => {
    // The refusal a permission-gated clipboard actually produces, installed before any page
    // script runs. Not a deleted API: a missing `navigator.clipboard` would throw a TypeError on
    // a different line and test a different failure.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new Error("Write permission denied.")),
        readText: () => Promise.reject(new Error("Read permission denied.")),
      },
    });
  });
  const page = await openGarden(context, BASE);
  await pressShare(page);
  await page.waitForTimeout(300);

  const said = await hint(page);
  check(
    "CONTROL: a refused clipboard is reported at all",
    /could not copy/i.test(said ?? ""),
    JSON.stringify((said ?? "").slice(0, 80)),
  );
  check(
    "and the un-copyable link is NOT crammed into the one-line hint",
    !(said ?? "").includes("#garden="),
    `${(said ?? "").length}-character hint`,
  );

  // RECOVERABLE. Somewhere on the page there has to be the whole link, in an element the player
  // can actually select. Measured, not assumed: an element whose rendered width is a fraction of
  // its text is the ellipsised hint again under a different id.
  const recovery = await page.evaluate(() => {
    const el = document.getElementById("share-fallback");
    if (!el) return null;
    const field = el.querySelector("input, textarea") ?? el;
    const text = "value" in field ? field.value : (field.textContent ?? "");
    const box = field.getBoundingClientRect();
    return {
      text,
      w: box.width,
      h: box.height,
      // A garden link is one base64url token with no spaces in it, so it wraps only if it is
      // told to break mid-token. Overflowing horizontally inside a box is the ellipsised hint
      // again wearing a border — measured, because the first version of this fallback LOOKED
      // right in a screenshot while the link ran off the right edge of the field.
      scrollW: field.scrollWidth,
      clientW: field.clientWidth,
      selectable: getComputedStyle(field).userSelect !== "none",
      tag: field.tagName,
    };
  });
  check(
    "the whole link is on the page, in something the player can select",
    Boolean(recovery) &&
      recovery.text.includes("#garden=") &&
      recovery.text.includes("/visit/") &&
      recovery.selectable,
    recovery
      ? `<${recovery.tag}> ${recovery.text.length} chars, ${Math.round(recovery.w)}x${Math.round(recovery.h)}px, user-select ${recovery.selectable ? "on" : "OFF"}`
      : "no #share-fallback element",
  );
  check(
    "and it is laid out to be read — not one clipped line",
    Boolean(recovery) && recovery.h > 24 && recovery.w > 200,
    recovery
      ? `${Math.round(recovery.w)}x${Math.round(recovery.h)}px for ${recovery.text.length} characters`
      : "n/a",
  );
  // A screen reader is told too. The visual fallback and the announcement are separate channels
  // and shipping one without the other is how the drawer got a share button nobody could hear.
  //
  // READ BEFORE THE RESIZE BELOW. A live region holds the LAST thing announced, and a resize
  // relayouts the garden, which re-grows its plants and announces the next one to finish. Read
  // after, this said "plot 3 finished: white raceme" and failed for a reason that had nothing to
  // do with the clipboard.
  const spoken = await page.evaluate(
    () => document.getElementById("say").textContent ?? "",
  );
  check(
    "and a screen reader is told the copy failed",
    /could not copy/i.test(spoken),
    JSON.stringify(spoken.slice(0, 80)),
  );

  // NARROW, because at 1280 a driver's small garden makes a link that fits on one line and the
  // check below is vacuous — it passed on a field the link was measurably running out of at
  // 900px wide. A real garden's link is around a thousand characters and a phone is 390 across,
  // so this is the ordinary case rather than the corner one.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(200);
  const narrow = await page.evaluate(() => {
    const f = document.getElementById("share-fallback-url");
    return f
      ? { scrollW: f.scrollWidth, clientW: f.clientWidth, chars: f.value.length }
      : null;
  });
  check(
    "CONTROL: the link is long enough to have to wrap at 390px",
    Boolean(narrow) && narrow.chars * 6 > narrow.clientW,
    narrow ? `${narrow.chars} characters in a ${narrow.clientW}px field` : "n/a",
  );
  check(
    "and the link WRAPS inside it rather than running off the edge",
    Boolean(narrow) && narrow.scrollW <= narrow.clientW + 1,
    narrow
      ? `content ${narrow.scrollW}px wide in a ${narrow.clientW}px field`
      : "n/a",
  );

  await context.close();
}

check("no page errors", errors.length === 0, errors.join(" · "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall share checks passed");
process.exit(failures ? 1 : 0);
