/**
 * Neutral, platform-independent atlas inputs used by the texture-allocation
 * research harness.
 *
 * The production code has two adapters (Node/sharp and browser/canvas) that
 * both build an `AtlasInput`-shaped value. This type is the smallest common
 * denominator needed to plan, render and measure an atlas without a DOM, a
 * canvas or Minecraft.
 */
import type { WrapMode } from '../../../src/texture-chart-math.ts';

export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

/** Decoded sRGB RGBA pixels with straight (unpremultiplied) alpha. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
  /** Content hash of the encoded source, used for sharing diagnostics. */
  key: string;
}

/**
 * One material batch, i.e. all triangles that share a material and therefore
 * share one sampler. `uvs`/`triangleAreas` are flat per-triangle arrays.
 */
export interface ChartInput {
  /** Unique, stable id inside one model. */
  id: string;
  /** Display name; may repeat across materials. */
  material: string;
  /** Unique material identity, including duplicates. */
  materialKey: string;
  /** Mesh / primitive / body-part label, kept for part-level experiments. */
  part: string;
  texture: RgbaImage | null;
  /** sRGB display color (glTF baseColorFactor converted to sRGB). */
  color: [number, number, number];
  opacity: number;
  alphaMode: AlphaMode;
  alphaCutoff: number;
  wrap: [WrapMode, WrapMode];
  /** Continuous unwrapped UV bounds, null for flat materials. */
  bounds: [number, number, number, number] | null;
  /** u0,v0,u1,v1,u2,v2 per triangle. */
  uvs: Float32Array | null;
  /** World-space triangle areas, parallel to `uvs`. */
  triangleAreas: Float32Array | null;
  /** Total world-space surface area. */
  area: number;
  /** Surface area excluded by the user before atlas planning, if any. */
  excludedArea?: number;
}

export interface ChartRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pad: number;
}

/** Triangles of one input that belong to a chart. */
export interface ChartTriangles {
  inputId: string;
  /** Triangle indices inside the input's UV list. */
  triangles: number[];
}

/** One packed UV island. */
export interface PlannedChart {
  /** Unique inside the plan. */
  chartId: string;
  inputId: string;
  rect: ChartRect;
  bounds: [number, number, number, number] | null;
  tiles: [number, number];
  /**
   * Linear UV→content mapping actually used by the planner. Production
   * desktop maps the cropped whole-tile interval, the browser maps the chart
   * bounds; keeping it explicit makes metrics independent of that detail.
   */
  map: { u: number; v: number; spanU: number; spanV: number };
  /** Per-input triangle lists; null means every triangle of `inputId`. */
  triangles: ChartTriangles[] | null;
  wrap: [WrapMode, WrapMode];
  /** Which planner feature produced this chart (diagnostics only). */
  origin: 'island' | 'material' | 'merged' | 'shared';
  /** Material names covered by this chart. */
  materials: string[];
  /** Estimated UV coverage inside the chart bounds, 0..1. */
  coverage: number;
}

export interface AtlasPlan {
  size: number;
  pad: number;
  charts: PlannedChart[];
  /** Applied demand scale after shrinking to fit (1 when nothing was scaled). */
  scale: number;
  /** Free-form planner diagnostics. */
  notes: string[];
}

export const wrapCode = (mode: WrapMode): number =>
  mode === 'clamp' ? 33071 : mode === 'mirror' ? 33648 : 10497;
