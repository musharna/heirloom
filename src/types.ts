export type Vec2 = { x: number; y: number };

export type PetalShape = "round" | "pointed" | "lobed" | "frilled";

/** Flat parameter struct consumed by the growth engine. Contains no genetic concepts. */
export type Phenotype = {
  // growth behaviour
  vigour: number; // 0..1 — total ticks and step length
  droop: number; // 0..1 — gravitropism weight (pull toward down)
  phototropism: number; // 0..1 — pull toward the light direction (up)
  stiffness: number; // 0..1 — damps all direction change
  branchiness: number; // 0..1 — branch probability per tick
  // structure
  baseWidth: number; // px at the base of the main stem
  taper: number; // per-tick width multiplier, must be < 1
  branchAngle: number; // radians
  branchWidthRatio: number; // 0..1 — child width as a fraction of parent
  // bloom
  doubled: boolean; // dd — stamens converted to petals
  petalShape: PetalShape;
  hueClass: 0 | 1 | 2 | 3 | 4;
  white: boolean; // pigment block expressed
  bloomRadius: number; // px
};

export type Tip = {
  id: number;
  pos: Vec2;
  dir: number; // radians. Screen coords: y grows downward, so "up" is -PI/2.
  width: number;
  age: number;
  depth: number;
  vigourLeft: number;
  alive: boolean;
  /**
   * True once this tip has risen clear of the ground zone. The ground-stop rule only
   * applies afterwards — otherwise a young shoot, which starts AT ground level, is judged
   * to have already hit the ground and dies on its fourth tick.
   */
  cleared: boolean;
};

export type StrokeSegment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w0: number;
  w1: number;
  depth: number;
  tick: number; // enables animation: draw only segments with tick <= t
  chain: number; // the Tip.id that emitted this — segments group into chains by this
};

export type PetalSpec = {
  center: Vec2;
  angle: number; // radians
  length: number;
  width: number;
  shape: PetalShape;
  colorDepth: number; // 0 = outer/pale, 1 = inner/dark
};

export type Bloom = {
  center: Vec2;
  radius: number;
  petals: PetalSpec[];
  /** Calyx behind the corolla. Fills the gaps between petals so a bloom reads layered. */
  sepals: PetalSpec[];
  hueClass: number;
  white: boolean;
  stamens: boolean; // false when doubled
  /** 0 = face-on, 1 = the shoot points straight down. Drives nodding foreshortening. */
  tilt: number;
  /**
   * Tick at which the shoot terminated and this flower appeared. Without it the renderer
   * cannot animate growth: segments would draw in over time while every flower popped in at
   * once on frame zero.
   */
  tick: number;
};

/** A leaf blade attached to a point on a stem. */
export type LeafSpec = {
  attach: Vec2;
  angle: number; // radians — direction the blade points
  length: number;
  width: number;
  /** Tick at which this leaf was emitted, so foliage also fills in as the plant grows. */
  tick: number;
  /** 0..1 per-leaf variation: blade fatness, serration, curl. Without it every leaf is one stamp. */
  seed: number;
  /** +1 / -1 — the side of the shoot this leaf grew on, so its curl bends away from the stem. */
  side: number;
};

export type Plant = {
  segments: StrokeSegment[];
  blooms: Bloom[];
  leaves: LeafSpec[];
};
