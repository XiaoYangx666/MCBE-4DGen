/**
 * Platform-independent atlas types.
 *
 * Both adapters (Node/`sharp` and browser/canvas) build these values from
 * their own model sources; the planner, budget solver and packer only ever see
 * this shape. No DOM, no Node, no three.js, no glTF.
 */
import type { WrapMode } from '../texture-chart-math.ts';

export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

/** Source texture dimensions and identity; pixels stay with the adapter. */
export interface TextureInfo {
  width: number;
  height: number;
  /** Content identity (hash or adapter key) used for sharing decisions. */
  key: string;
}

/** One material batch: all triangles sharing a sampler. */
export interface ChartInput {
  id: string;
  material: string;
  materialKey: string;
  part?: string;
  texture: TextureInfo | null;
  /** sRGB display color. */
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
}

export interface ChartRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pad: number;
}

export interface ChartTriangles {
  inputId: string;
  triangles: number[];
}

export interface PlannedChart {
  chartId: string;
  inputId: string;
  rect: ChartRect;
  bounds: [number, number, number, number] | null;
  tiles: [number, number];
  /** Linear UV -> content mapping used by the planner. */
  map: { u: number; v: number; spanU: number; spanV: number };
  triangles: ChartTriangles[] | null;
  wrap: [WrapMode, WrapMode];
  origin: 'island' | 'material' | 'merged' | 'shared';
  materials: string[];
  coverage: number;
}

export interface AtlasPlan {
  size: number;
  pad: number;
  charts: PlannedChart[];
  scale: number;
  notes: string[];
}
