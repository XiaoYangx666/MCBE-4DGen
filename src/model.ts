import type { Document } from '@gltf-transform/core';

/** Document retains nodes, transforms, primitives, materials, skins and animation data. */
export interface IntermediateModel {
  document: Document;
  source: {
    path: string;
    format: 'obj' | 'gltf' | 'glb';
    units: 'meters' | 'unspecified';
    coordinates: 'right-handed-y-up' | 'unspecified';
    importer: 'gltf-transform' | 'libassimp';
    backend?: 'native' | 'wasm';
  };
  warnings: string[];
}
