export type V2 = [number, number];
export type V3 = [number, number, number];
export type VertexRef = [number, number, number];
export type Polygon = [VertexRef, VertexRef, VertexRef] | [VertexRef, VertexRef, VertexRef, VertexRef];
export interface PolyMesh {
  normalized_uvs: boolean;
  positions: V3[];
  normals: V3[];
  uvs: V2[];
  polys: Polygon[];
}
export interface BedrockBone {
  name: string;
  parent?: string;
  pivot?: V3;
  rotation?: V3;
  poly_mesh?: PolyMesh;
}
export interface BedrockGeometry {
  texturewidth: number;
  textureheight: number;
  visible_bounds_width?: number;
  visible_bounds_height?: number;
  visible_bounds_offset?: V3;
  bones: BedrockBone[];
}
export interface BedrockGeometryFile {
  format_version: '1.8.0';
  [identifier: `geometry.${string}`]: BedrockGeometry;
}

export function isGeometryIdentifier(value: string): value is `geometry.${string}` {
  return /^geometry\.[A-Za-z0-9_.:'-]+$/.test(value);
}
