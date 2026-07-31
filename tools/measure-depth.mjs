/**
 * How much depth is actually in the picture?
 *
 * Two visual claims in this project have been made confidently and then falsified by
 * measurement — the palette that was "over-saturated" measured less saturated than its
 * reference, and the spike that read as "a dense mass" turned out to have its flowers further
 * apart than an umbel's. So the depth work gets numbers first.
 *
 * Everything here is measured from PIXELS the game actually drew, not from the model. The
 * question "can you tell which of these two overlapping plants is in front" is a question about
 * what reached the canvas, and no amount of inspecting the scene graph answers it.
 *
 *   node tools/measure-depth.mjs            # report
 *   node tools/measure-depth.mjs --json     # machine-readable, for before/after diffing
 */
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
const AS_JSON = process.argv.includes('--json');

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
/**
 * Fill every plot with the SAME genome.
 *
 * This is the control that makes the whole measurement mean anything. The first version simply
 * measured the garden as sown, and the numbers it produced — an 18.5 spread in brightness
 * across the bed — were entirely GENOME variation: a white plant next to a coral one. Depth
 * cues and flower colour were being added together and reported as one number.
 *
 * With one genome in every plot, every plant is identical by construction (§6: growth is a pure
 * function of the genome), so any remaining difference in brightness, saturation or crispness
 * is the renderer saying something about position — which is exactly the thing under test.
 */
await page.evaluate(() => window.__seek(1200));
await page.waitForTimeout(400);
const code = await page.evaluate(() => window.__codes().plots.find(Boolean));
const plots = await page.evaluate(() => window.__plotCount());
for (let i = 0; i < plots; i++) {
  await page.evaluate((c) => {
    location.hash = `#g=${c}`;
  }, code);
  await page.waitForTimeout(120);
  const ok = await page.evaluate((plot) => {
    const s = window.__state();
    if (!s.tray) return false;
    // Plant directly: this measures the RENDERER, and driving the pointer here would only add
    // a way for the measurement to fail for reasons that have nothing to do with pixels.
    window.__plantInto(plot);
    return true;
  }, i);
  if (!ok) break;
}
await page.evaluate(() => window.__seek(4200));
await page.waitForTimeout(1600);

const metrics = await page.evaluate(() => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const scale = c.width / window.__size().w; // device pixels per canvas unit
  const img = g.getImageData(0, 0, c.width, c.height);
  const D = img.data;
  const W = c.width;

  const at = (x, y) => {
    const i = (y * W + x) * 4;
    return [D[i], D[i + 1], D[i + 2]];
  };
  const luma = ([r, gg, b]) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const sat = ([r, gg, b]) => {
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };

  /** The ground colour, sampled well above the bed where nothing grows. */
  const groundSamples = [];
  for (let x = 4; x < W; x += 29)
    for (let y = 4; y < Math.floor(c.height * 0.12); y += 11)
      groundSamples.push(at(x, y));
  const groundLuma =
    groundSamples.reduce((a, p) => a + luma(p), 0) / groundSamples.length;

  /**
   * Per-plant statistics over the pixels that are actually PLANT.
   *
   * A bounding box is mostly air, so pixels close to the ground colour are excluded — what is
   * left is ink. Without that filter every measurement would be dominated by background and
   * every plant would look identical whatever the render did.
   */
  const boxes = window.__plantBoxes();
  const plants = boxes.map((b) => {
    const x0 = Math.max(0, Math.floor(b.minX * scale));
    const x1 = Math.min(W - 1, Math.ceil(b.maxX * scale));
    const y0 = Math.max(0, Math.floor(b.minY * scale));
    const y1 = Math.min(c.height - 1, Math.ceil(b.maxY * scale));
    let n = 0;
    let lum = 0;
    let satu = 0;
    let edge = 0;
    // Total brightness ABOVE the ground, over the whole box, with no threshold.
    //
    // Mean luma over thresholded pixels cannot see the dimming cue at all: fading a plant
    // toward the ground pushes its faintest pixels below the threshold, so the survivors'
    // average stays put and the measurement reports nothing. Reported per unit of box area so
    // the scale cue cancels out and this is a statement about brightness alone.
    let ink = 0;
    let boxArea = 0;
    for (let y = y0 + 1; y < y1 - 1; y += 2) {
      for (let x = x0 + 1; x < x1 - 1; x += 2) {
        const p = at(x, y);
        const l = luma(p);
        boxArea++;
        ink += Math.max(0, l - groundLuma);
        if (Math.abs(l - groundLuma) < 12) continue; // background, not plant
        n++;
        lum += l;
        satu += sat(p);
        // Local gradient magnitude: a proxy for how crisp this plant's linework is.
        edge +=
          Math.abs(l - luma(at(x + 1, y))) + Math.abs(l - luma(at(x, y + 1)));
      }
    }
    return {
      plot: b.plot,
      depth: b.depth,
      pixels: n,
      luma: n ? lum / n : 0,
      saturation: n ? satu / n : 0,
      edgeDensity: n ? edge / n : 0,
      inkDensity: boxArea ? ink / boxArea : 0,
      width: b.maxX - b.minX,
      baseX: b.baseX,
    };
  });

  /**
   * Ground contact: how much darker the soil is immediately under a stem than a little to the
   * side of it. Zero means the plant is pasted onto the ground rather than sitting in it.
   */
  const contact = boxes.map((b) => {
    const bx = Math.round(b.baseX * scale);
    const by = Math.round(b.baseY * scale);
    const under = [];
    const beside = [];
    for (let dy = 2; dy < 10; dy++) {
      for (let dx = -10; dx <= 10; dx++)
        if (bx + dx > 0 && bx + dx < W) under.push(luma(at(bx + dx, by + dy)));
      for (const dx of [-70, -55, 55, 70])
        if (bx + dx > 0 && bx + dx < W) beside.push(luma(at(bx + dx, by + dy)));
    }
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return { plot: b.plot, darkening: mean(beside) - mean(under) };
  });

  /** Do any two plants OVERLAP horizontally? Only then is occlusion even at stake. */
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (boxes[i].maxX > boxes[j].minX && boxes[j].maxX > boxes[i].minX)
        overlaps++;

  return { groundLuma, plants, contact, overlaps, canvas: { w: W, h: c.height } };
});

/**
 * Rank correlation between how far back a plant is and some visual quantity.
 *
 * The right shape for this measurement, and the second attempt at it. A plain SPREAD across the
 * bed conflates everything: with different genomes it measured flower colour, and even with one
 * genome it moved when the depth treatment changed the number of pixels bright enough to count.
 * A correlation asks the question that is actually being posed — does a plant LOOK further away
 * when it IS further away — and is unaffected by how many pixels each plant happens to have.
 *
 * -1 means perfectly ordered by depth, 0 means the picture says nothing about position.
 */
const rankCorrelation = (key) => {
  const v = metrics.plants.filter((p) => p.pixels > 300);
  if (v.length < 3) return 0;
  const rank = (vals) => {
    const idx = vals.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const a = rank(v.map((p) => p.depth));
  const b = rank(v.map((p) => p[key]));
  const n = a.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (a[i] - b[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
};

const spread = (key) => {
  const v = metrics.plants.filter((p) => p.pixels > 500).map((p) => p[key]);
  return v.length < 2 ? 0 : Math.max(...v) - Math.min(...v);
};

const out = {
  plants: metrics.plants.length,
  overlappingPairs: metrics.overlaps,
  groundLuma: +metrics.groundLuma.toFixed(1),
  // The headline numbers. A bed with no depth treatment has near-zero spread on all three:
  // every plant is drawn at the same brightness, the same saturation and the same crispness,
  // so nothing in the picture says which one is nearer.
  lumaSpread: +spread('luma').toFixed(1),
  saturationSpread: +spread('saturation').toFixed(3),
  edgeSpread: +spread('edgeDensity').toFixed(2),
  // The headline. Negative = further back is dimmer/softer, which is what depth looks like.
  lumaVsDepth: +rankCorrelation('inkDensity').toFixed(2),
  // Box width, NOT pixel count. Pixel count flipped sign between runs (-0.14, then +0.54)
  // because a plant occluded by a nearer neighbour loses pixels, and which plants are occluded
  // depends on where they stand rather than on how far back they are. Box width measures the
  // scale cue itself and nothing else.
  sizeVsDepth: +rankCorrelation('width').toFixed(2),
  meanContactDarkening: +(
    metrics.contact.reduce((a, c) => a + c.darkening, 0) /
    Math.max(1, metrics.contact.length)
  ).toFixed(1),
  perPlant: metrics.plants.map((p) => ({
    plot: p.plot,
    px: p.pixels,
    luma: +p.luma.toFixed(1),
    sat: +p.saturation.toFixed(3),
    edge: +p.edgeDensity.toFixed(2),
  })),
  errors,
};

if (AS_JSON) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`plants ${out.plants} · overlapping pairs ${out.overlappingPairs} · ground luma ${out.groundLuma}\n`);
  console.log('plot    pixels     luma    sat    edge');
  for (const p of out.perPlant)
    console.log(
      `${String(p.plot).padStart(4)}  ${String(p.px).padStart(8)}  ${String(p.luma).padStart(7)}  ${String(p.sat).padStart(5)}  ${String(p.edge).padStart(6)}`,
    );
  console.log(`\nDOES A PLANT LOOK FURTHER WHEN IT IS FURTHER? (-1 = perfectly, 0 = not at all)`);
  console.log(`  drawn size vs depth  ${out.sizeVsDepth}   <- the reliable one`);
  console.log(`  brightness vs depth  ${out.lumaVsDepth}   <- CONFOUNDED, see note`);
  console.log(
    `    a plant occluded by a nearer neighbour holds less ink whatever its own depth, so this\n` +
      `    number swings sign between runs (0.26, -0.37, -0.54 observed) and is not evidence.\n` +
      `    The dimming cue is pinned in test/bed.test.ts instead, where alpha can be checked\n` +
      `    against depth directly with nothing in front of it.`,
  );
  console.log(`\nDEPTH CUES ACROSS THE BED (spread; confounded by genome and growth stage)`);
  console.log(`  luma spread        ${out.lumaSpread}`);
  console.log(`  saturation spread  ${out.saturationSpread}`);
  console.log(`  edge spread        ${out.edgeSpread}`);
  console.log(`\nGROUND CONTACT`);
  console.log(`  mean darkening under a stem  ${out.meanContactDarkening}  (0 = pasted on)`);
  if (errors.length) console.log(`\npage errors: ${errors[0]}`);
}

// A picture of exactly what was measured. One genome in every plot means any visible
// difference between these plants is the renderer talking about position — so this is the
// image to judge the depth work by, and the ordinary garden shot is not.
await page.screenshot({ path: 'shots/depth-control.png' });
console.log('\nwrote shots/depth-control.png');

await browser.close();
