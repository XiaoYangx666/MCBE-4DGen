export type Vec3 = [number, number, number];

// Binding rules, codes and the player skeleton are shared with the Node exporter.
import type { AlphaMode } from '../../src/texture-pixels.ts';
import type { HumanoidPart } from '../../src/humanoid-binding.ts';
export type { AlphaMode, HumanoidPart };
export {
  CODE_PART,
  PART_CODE,
} from '../../src/humanoid-binding.ts';

/** An image that can be drawn into a canvas. */
export interface TextureSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Stable identity of the decoded image, used to share atlas rectangles. */
  key: string;
  /** three.js wrap constant (1000 repeat / 1001 clamp / 1002 mirror). */
  wrapS?: number;
  wrapT?: number;
}

/**
 * Flat triangle soup after world transforms. UVs are already in image space
 * (v grows downwards), which is also canvas space; they may leave 0..1 and are
 * expanded with the source wrap mode when the atlas is rendered.
 */
export interface SourceBatch {
  key: string;
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  color: Vec3;
  opacity: number;
  /** glTF alpha semantics; shared with the Node atlas baker. */
  alphaMode: AlphaMode;
  /** MASK threshold, 0.5 when the source does not specify one. */
  alphaCutoff: number;
  doubleSided: boolean;
  texture: TextureSource | null;
  /** Continuous UV rectangle of this material, not clamped to 0..1. */
  uvBounds: [number, number, number, number] | null;
  triangles: number;
  /** World-space surface area, used to budget atlas space. */
  area: number;
  /**
   * One `PART_CODE` per triangle, present when the model was extracted with a
   * humanoid rig. Missing entries mean "body".
   */
  parts?: Uint8Array;
}

export interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pad: number;
}

export interface AtlasBuild {
  canvas: HTMLCanvasElement;
  size: number;
  rects: Map<string, AtlasRect>;
  /** Share of atlas pixels with a non-zero alpha channel, 0..1. */
  coverage: number;
}
