/**
 * Research inputs extend the shared core types with decoded pixels and world
 * positions, which only the experiment renderer and diagnostics need.
 */
export type {
  AlphaMode,
  AtlasPlan,
  ChartRect,
  ChartTriangles,
  PlannedChart,
  TextureInfo,
} from '../../../src/atlas-core/types.ts';
export type { ChartInput as CoreChartInput } from '../../../src/atlas-core/types.ts';
import type { ChartInput as CoreChartInput } from '../../../src/atlas-core/types.ts';
import type { WrapMode } from '../../../src/texture-chart-math.ts';

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
 * share one sampler. Adds decoded pixels and world positions to the core shape.
 */
export interface ChartInput extends Omit<CoreChartInput, 'texture'> {
  texture: RgbaImage | null;
  /** World-space xyz per triangle corner (9 floats), used by view rendering. */
  positions?: Float32Array | null;
  /** Unique vertex id per triangle corner (3 per triangle), when available. */
  vertexIds?: Int32Array | null;
}

export const wrapCode = (mode: WrapMode): number =>
  mode === 'clamp' ? 33071 : mode === 'mirror' ? 33648 : 10497;
