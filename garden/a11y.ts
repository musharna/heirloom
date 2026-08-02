/**
 * The hidden semantic mirror.
 *
 * Real buttons in document flow, not a focusable canvas with a roving cursor. The browser then
 * owns focus order, focus restoration and browse mode — three things that are easy to
 * reimplement and hard to reimplement correctly — and a driver can query this by role and
 * accessible name instead of by pixel geometry.
 *
 * NOT positioned over the canvas. Plots are drawn through a depth transform at responsive
 * geometry, so overlaying would mean syncing twenty-one elements against world layout forever,
 * and the focus ring is drawn in canvas anyway.
 */
export type Target =
  | { kind: "plot"; index: number }
  | { kind: "seed"; index: number }
  | { kind: "carrier"; index: number };

const mirror = document.getElementById("mirror")!;
const say = document.getElementById("say")!;

const targetOf = (el: HTMLElement): Target | null => {
  const kind = el.dataset["kind"];
  const index = Number(el.dataset["index"]);
  if (
    (kind !== "plot" && kind !== "seed" && kind !== "carrier") ||
    !Number.isInteger(index)
  )
    return null;
  return { kind, index };
};

/**
 * Wire up activation.
 *
 * Delegated to the list rather than bound per button, so rebuilding the list never has to
 * re-bind anything. A per-button listener is how a rebuild silently drops the handlers for
 * whichever buttons it replaced.
 *
 * `click` and not `keydown`, deliberately: these are real buttons, so Enter and Space already
 * produce a click, and assistive technology can activate one without any key being pressed at
 * all. Listening for the key instead of the activation would leave the mirror dead to the
 * screen-reader users it exists for.
 */
export function mountMirror(onAct: (t: Target) => void): void {
  mirror.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest("button");
    if (!el) return;
    const t = targetOf(el as HTMLElement);
    if (t) onAct(t);
  });
}

/** What the player is focused on, or null if focus is anywhere else on the page. */
export function focusedTarget(): Target | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el.tagName !== "BUTTON" || !mirror.contains(el)) return null;
  return targetOf(el);
}

/**
 * Rebuild the labels.
 *
 * Reuses the existing buttons when the count has not changed, so FOCUS SURVIVES. Rebuilding the
 * list wholesale on every sync would throw focus back to the body every time a plant grew, which
 * reads as the page fighting the player.
 */
export function syncMirror(
  plotLabels: string[],
  seedLabels: string[],
  carrierLabels: string[] = [],
): void {
  const all = [...plotLabels, ...seedLabels, ...carrierLabels];
  if (mirror.children.length !== all.length) {
    mirror.replaceChildren(
      ...all.map(() => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        li.appendChild(b);
        return li;
      }),
    );
  }
  // Three contiguous runs, so a button's KIND is its position and its INDEX is its offset within
  // its own run. Carriers come last on purpose: they arrive and leave on their own, and putting
  // them anywhere earlier would shuffle the tab order of the bed underneath the player.
  [...mirror.querySelectorAll("button")].forEach((b, i) => {
    const kind =
      i < plotLabels.length
        ? "plot"
        : i < plotLabels.length + seedLabels.length
          ? "seed"
          : "carrier";
    const offset =
      kind === "plot"
        ? i
        : kind === "seed"
          ? i - plotLabels.length
          : i - plotLabels.length - seedLabels.length;
    b.dataset["kind"] = kind;
    b.dataset["index"] = String(offset);
    const text = all[i] ?? "";
    if (b.textContent !== text) b.textContent = text;
  });
}

/**
 * Say something once, politely.
 *
 * Cleared and re-set on the next frame because a live region whose text is replaced with an
 * IDENTICAL string announces nothing. Two plants finishing with the same description would be a
 * single announcement, and the player would never learn the second had happened.
 */
export function announce(text: string): void {
  if (!text) return;
  say.textContent = "";
  requestAnimationFrame(() => {
    say.textContent = text;
  });
}
