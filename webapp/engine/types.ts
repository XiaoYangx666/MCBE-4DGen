export type Vec3 = [number, number, number];

/** An image that can be drawn into a canvas. */
export interface TextureSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Stable identity of the decoded image, used to share atlas rectangles. */
  key: string;
}

/**
 * Flat triangle soup after world transforms. UVs are normalized and already in
 * image space (v grows downwards), which is also canvas space.
 */
export interface SourceBatch {
  key: string;
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  color: Vec3;
  opacity: number;
  doubleSided: boolean;
  texture: TextureSource | null;
  /** Tight UV rectangle of this material, clamped to 0..1. */
  uvBounds: [number, number, number, number] | null;
  triangles: number;
  /** World-space surface area, used to budget atlas space. */
  area: number;
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
