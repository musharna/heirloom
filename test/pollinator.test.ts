import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import type { ReplayEntry } from "../src/game/save";
import {
  CARRIER_SIT_TICKS,
  POLLINATED_CHANCE,
  canCarrierArrive,
  didPollinate,
  pickPollen,
} from "../src/game/pollinator";

const log: ReplayEntry[] = [
  { g: "AAAAAAAAAAAAAA", x: 10 },
  { g: "BBBBBBBBBBBBBB", x: 20 },
];

describe("canCarrierArrive", () => {
  it("needs somewhere to land AND something to carry", () => {
    expect(canCarrierArrive(log, 4)).toBe(true);
  });

  it("refuses when the retirement log is empty", () => {
    // This is why the mechanic needs no unlock flag. A new garden has no history, so no carrier
    // can arrive until the player has replaced something.
    expect(canCarrierArrive([], 4)).toBe(false);
  });

  it("refuses when nothing is in bloom", () => {
    expect(canCarrierArrive(log, 0)).toBe(false);
  });
});

describe("pickPollen", () => {
  it("returns a genome that is actually in the log", () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      expect(log.map((e) => e.g)).toContain(pickPollen(log, rand));
    }
  });

  it("eventually returns every entry, rather than always the first", () => {
    // A `log[0]` implementation passes the check above on every draw. Coverage of the list is
    // the property that separates "picks from the log" from "picks the log's first element".
    const rand = mulberry32(4);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickPollen(log, rand)!);
    expect(seen.size).toBe(log.length);
  });

  it("returns null for an empty log rather than throwing", () => {
    expect(pickPollen([], mulberry32(1))).toBeNull();
  });
});

describe("didPollinate", () => {
  it("fires at about POLLINATED_CHANCE over many draws", () => {
    // Measured over 20,000 draws, not asserted at one: a single call tests the RNG, not the rule.
    const rand = mulberry32(9);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (didPollinate(rand)) hits++;
    expect(hits / n).toBeGreaterThan(POLLINATED_CHANCE - 0.02);
    expect(hits / n).toBeLessThan(POLLINATED_CHANCE + 0.02);
  });
});

describe("the tuning constants", () => {
  it("keeps the pollination chance a rare event, not a coin flip", () => {
    expect(POLLINATED_CHANCE).toBeGreaterThan(0);
    expect(POLLINATED_CHANCE).toBeLessThan(0.5);
  });

  it("expresses sitting time in ticks, not seconds", () => {
    // SPEED is 1.4 per frame at 60fps, so about 84 ticks a second; 12 seconds is about 1008.
    // A value near 12 would mean someone wrote seconds, and a carrier would vanish instantly.
    expect(CARRIER_SIT_TICKS).toBeGreaterThan(800);
    expect(CARRIER_SIT_TICKS).toBeLessThan(1200);
  });
});
