/**
 * A canvas context that draws nothing and writes down what it was asked to do.
 *
 * Unit tests here have no pixels — `test/cache.test.ts` already stubs the context with a Proxy,
 * because there is no canvas implementation in the test environment. An op log is the strongest
 * instrument available at this layer, and it happens to be exactly the right one for the single
 * risk in extracting `paintPlant` into passes: that a pass moves relative to another. Pixel
 * fidelity is a separate question and belongs to `tools/check-growth.mjs`, in a real browser.
 *
 * Numbers are rounded to three places before being recorded. Canvas coordinates come out of
 * trigonometry and would otherwise differ in the last bit between runs for reasons that have
 * nothing to do with drawing order.
 */
export function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  ops: string[];
} {
  const ops: string[] = [];
  const round = (v: unknown): unknown =>
    typeof v === "number" ? Math.round(v * 1000) / 1000 : v;
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        // Gradients are objects the caller then configures, so they need a real stand-in
        // rather than a no-op — and their colour stops are part of what was drawn.
        if (prop === "createLinearGradient" || prop === "createRadialGradient")
          return (...a: unknown[]) => {
            ops.push(`${prop}(${a.map(round).join(",")})`);
            return {
              addColorStop: (o: number, c: string) =>
                ops.push(`addColorStop(${round(o)},${c})`),
            };
          };
        return (...a: unknown[]) => {
          ops.push(`${prop}(${a.map(round).join(",")})`);
        };
      },
      set(_t, prop: string, value: unknown) {
        // Style assignments are drawing instructions too: a fill that changed colour is a
        // change even when every path call is identical.
        ops.push(`${prop}=${round(value)}`);
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

/**
 * A stable digest of an operation log.
 *
 * Hand-rolled rather than `node:crypto` because nothing else in `test/` imports a node builtin
 * and this project has no `@types/node` — adding one so a test could hash a string would be a
 * dependency change made for convenience.
 *
 * Two independent FNV-1a-style accumulators with different constants, concatenated, so the
 * result carries 64 bits. This detects accidental change, which is all it is for; it is not a
 * security hash and nothing here is adversarial.
 */
export function digestOps(ops: string[]): string {
  const s = ops.join("\n");
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
