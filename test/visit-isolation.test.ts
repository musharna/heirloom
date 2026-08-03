/**
 * A VISIT IS READ-ONLY BY CONSTRUCTION — asserted against the module graph, not against prose.
 *
 * `visit/visit.ts` says it cannot write the visitor's garden because the writer is not on its
 * import graph. That claim was previously "checked" with
 * `grep -n "save\|pollinator\|insects" visit/visit.ts`, which cannot discriminate in EITHER
 * direction:
 *
 *   - FALSE POSITIVE on prose. The doc comment explaining the rule contains all three words, so
 *     the grep fired on an untouched file and the fix was to reword a COMMENT. The check was
 *     measuring English.
 *   - FALSE NEGATIVE on the actual risk. The danger is not `visit.ts` importing `save.ts`
 *     directly — nobody does that by accident. It is `visit.ts` importing something that itself
 *     imports the writer, one or two hops down. A grep of one file sees nothing, and the central
 *     claim of the design is silently false.
 *
 * So this walks the TRANSITIVE relative-import graph instead. It is a real check of the real
 * claim, it runs in the normal unit suite, and it needs no browser.
 *
 * Sources come from `import.meta.glob(..., { query: "?raw" })` rather than `node:fs`: that is a
 * genuine filesystem read performed by Vite at transform time — the same files, read the same
 * way the bundler reads them — and it does not require `@types/node`, which this project does
 * not install.
 */
import { describe, expect, it } from "vitest";

/** Every TypeScript source that can appear on a page's graph, keyed by repo-relative path. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...import.meta.glob("/src/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
    ...import.meta.glob("/garden/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
    ...import.meta.glob("/visit/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  }).map(([k, v]) => [k.replace(/^\//, ""), v as string]),
);

/** The pages themselves, read the same way. Vite is what decides what a page's entry IS. */
const PAGES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("/visit/*.html", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([k, v]) => [k.replace(/^\//, ""), v as string]),
);

/**
 * Every specifier a module imports, in ANY of the forms this codebase uses.
 *
 * The `from` clause is matched on its own rather than by matching a whole import statement.
 * That is the point: a statement-shaped pattern has to span newlines, and the previous walker's
 * did not — it was blind to
 *
 *     import {
 *       SAVE_KEY,
 *     } from "../src/game/save";
 *
 * which is the shape of EVERY import in `garden/garden.ts`, so it reported a perfect clean
 * while reading almost nothing. `from` and its string are always adjacent, whatever the
 * statement did before them, so anchoring there is newline-proof by construction.
 *
 * Neither pattern nests a lazy quantifier inside a greedy one, so neither can backtrack
 * catastrophically on a 2,000-line file.
 */
export function importSpecifiers(source: string): string[] {
  const found = new Set<string>();
  // `import x from`, `import type {…} from`, `import * as x from`, `export … from`,
  // `export * from` — multi-line or not.
  for (const m of source.matchAll(/\bfrom\s*["']([^"'\n]+)["']/g))
    found.add(m[1]!);
  // Side-effect `import "./x"` and dynamic `import("./x")`, which have no `from` at all.
  for (const m of source.matchAll(/\bimport\s*\(?\s*["']([^"'\n]+)["']/g))
    found.add(m[1]!);
  return [...found];
}

/** Resolve a relative specifier against its importer. Pure string work; no path module. */
function resolveSpecifier(importer: string, spec: string): string {
  const out: string[] = [];
  for (const part of [
    ...importer.split("/").slice(0, -1),
    ...spec.split("/"),
  ]) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  const base = out.join("/");
  // Extensionless (this repo's style), explicit `.ts`, or a directory whose entry is index.ts.
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`])
    if (candidate in SOURCES) return candidate;
  throw new Error(
    `${importer} imports "${spec}", which resolves to no source file (tried ${base}, ${base}.ts, ${base}/index.ts)`,
  );
}

/**
 * Breadth-first closure from an entry module.
 *
 * Returns each reachable module mapped to the PATH that reached it. A failure that says only
 * "visit reaches save.ts" leaves the reader to find the edge themselves; one that says
 * "visit/visit.ts -> src/game/postcard.ts -> src/game/save.ts" names the import to delete.
 * BFS, so the path reported is the shortest one.
 */
function importClosure(entry: string): Map<string, string[]> {
  if (!(entry in SOURCES)) throw new Error(`no such module: ${entry}`);
  const paths = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    const here = paths.get(file)!;
    for (const spec of importSpecifiers(SOURCES[file]!)) {
      if (!spec.startsWith(".")) continue;
      const target = resolveSpecifier(file, spec);
      if (paths.has(target)) continue;
      paths.set(target, [...here, target]);
      queue.push(target);
    }
  }
  return paths;
}

/**
 * The four modules a visit must never be able to reach.
 *
 * `garden/garden.ts` is the CONTROLLER — the four verbs and the save scheduler. `src/game/garden.ts`
 * is the pure model (`grow`, `isGrown`) and is not only allowed but required; a visit has to grow
 * the plants it was sent. They differ by one path segment, so they are named in full and the
 * allowance below is asserted rather than assumed.
 */
const FORBIDDEN = [
  "src/game/save.ts",
  "garden/garden.ts",
  "src/game/pollinator.ts",
  "garden/insects.ts",
];

/**
 * The three of those that the positive control can actually prove anything with.
 *
 * `garden/garden.ts` is excluded because it is the control's own ENTRY: the walker records it
 * before traversing a single edge, so "the control reaches it" is true of a walker that reads
 * nothing at all. That is precisely the defect this whole file exists to replace, so it must not
 * be counted as a fourth proof — it is asserted separately below, as the entry it is.
 */
const REACHED_BY_A_REAL_EDGE = FORBIDDEN.filter(
  (f) => f !== "garden/garden.ts",
);

const visit = importClosure("visit/visit.ts");
const garden = importClosure("garden/garden.ts");

describe("the extractor", () => {
  it("finds every import form this repo uses, multi-line included", () => {
    const source = `
import { a } from "./one";
import type { B } from "./two";
import {
  c,
  d,
} from "./three";
import "./four";
import * as e from "./five";
export { f } from "./six";
export * from "./seven";
const g = await import("./eight");
import def, { h } from "./nine";
import x from "vitest";
`;
    expect(importSpecifiers(source).sort()).toEqual([
      "./eight",
      "./five",
      "./four",
      "./nine",
      "./one",
      "./seven",
      "./six",
      "./three",
      "./two",
      "vitest",
    ]);
  });
});

describe("a visit cannot reach the machinery that writes a garden", () => {
  it.each(FORBIDDEN)("visit/visit.ts never reaches %s", (forbidden) => {
    expect(visit.get(forbidden)?.join(" -> ") ?? null).toBeNull();
  });

  it("the pure MODEL src/game/garden.ts is allowed, and is on the graph", () => {
    // Guards the inverse mistake: a walker that forbade `src/game/garden.ts` by conflating it
    // with the controller would pass the four checks above for entirely the wrong reason.
    expect(visit.get("src/game/garden.ts")?.join(" -> ")).toBe(
      "visit/visit.ts -> src/game/garden.ts",
    );
  });

  /**
   * POSITIVE CONTROL — without it this file is a rubber stamp.
   *
   * A walker that reads nothing reports a perfect clean: a wrong base path, a glob that matches
   * no files, a pattern blind to the one import shape the codebase actually writes. Each of
   * these is reached from `garden/garden.ts` through a MULTI-LINE import statement, so a walker
   * with the previous bug fails here loudly instead of passing there silently.
   *
   * The path LENGTH is what makes that true. `>= 2` means at least one edge was traversed;
   * asserting mere presence is what let the degenerate entry case sit in this list looking like
   * a fourth proof.
   */
  it.each(REACHED_BY_A_REAL_EDGE)(
    "POSITIVE CONTROL: garden/garden.ts DOES reach %s, across a real edge",
    (forbidden) => {
      const path = garden.get(forbidden);
      expect(path?.join(" -> ")).toBeTruthy();
      expect(path?.length).toBeGreaterThanOrEqual(2);
    },
  );

  it("garden/garden.ts is the control's ENTRY — this one proves nothing", () => {
    // Trivial BY CONSTRUCTION, and asserted here so it cannot be mistaken for detection. The
    // walker seeds its result with the entry before following any import, so a walker that read
    // no files at all would still "reach" this. It stays in FORBIDDEN because the VISIT must
    // genuinely never reach it; it is only useless on the control side.
    expect(garden.get("garden/garden.ts")).toEqual(["garden/garden.ts"]);
  });

  it("POSITIVE CONTROL: the walker read a real graph, not an empty one", () => {
    expect(garden.size).toBeGreaterThan(20);
    expect(visit.size).toBeGreaterThan(8);
    expect(visit.has("src/game/postcard.ts")).toBe(true);
  });
});

/**
 * AND THE PAGE REALLY LOADS THAT MODULE, AND ONLY THAT MODULE.
 *
 * Everything above walks the graph from `visit/visit.ts`, on the assumption that `visit.ts` is
 * what the visit page runs. Nothing checked the assumption. `visit/index.html` is the shipped
 * entry — it is what `vite.config.ts` lists as an input — and a second
 * `<script type="module" src="../garden/garden.ts">` beside the first would put the controller,
 * the save writer and the bees on the page while every assertion above stayed green. The graph
 * would be immaculate and the page would still write the visitor's garden.
 *
 * Regex over the source rather than a DOM parse: this project installs no HTML parser, and what
 * is being asserted is a property of the FILE — how many script elements it contains — which a
 * lenient parser could quietly normalise away.
 */
describe("the shipped visit page", () => {
  const html = PAGES["visit/index.html"];

  it("CONTROL: the page was actually read", () => {
    // A glob that matched nothing would make every assertion below vacuously true.
    expect(html).toBeTypeOf("string");
    expect(html!.length).toBeGreaterThan(500);
    expect(html).toContain("<canvas");
  });

  it("loads exactly one module, and it is the one the graph above walks", () => {
    const tags = [...html!.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/type\s*=\s*"module"/);
    const src = /src\s*=\s*"([^"]+)"/.exec(tags[0]!)?.[1];
    expect(src).toBe("./visit.ts");
    // Named as the walker names it, so the two cannot drift apart silently.
    expect(`visit/${src!.replace(/^\.\//, "")}`).toBe("visit/visit.ts");
  });

  it("and carries no inline script either", () => {
    // `<script>` with a body has no `src` to check, so the count above is the only thing that
    // catches it — asserted separately because a future edit could relax that count.
    expect(html).not.toMatch(/<script\b[^>]*>\s*[^\s<]/i);
  });
});
