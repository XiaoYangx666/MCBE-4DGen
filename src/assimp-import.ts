/**
 * Assimp's default post-process also runs `joinIdenticalVertices`, which is
 * pathological for large MMD meshes: an 82k-vertex PMX took about 60 s and
 * expanded to 347k vertices, and the browser build measured ~70 s for a
 * 116k-triangle model. The remaining steps keep the output valid (triangles,
 * UVs, one primitive type) and finish in about a second.
 *
 * Shared by the Node importer and the browser PMX conversion so the two
 * pipelines cannot drift apart again.
 */
export const ASSIMP_IMPORT_POST_PROCESS = [
  'triangulate',
  'generateUvCoordinates',
  'sortByPrimitiveType',
] as const;
