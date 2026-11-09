import type { Document } from '@gltf-transform/core';
import type { TextureHint } from './texture-policy.ts';
import type { ReductionHint } from './reduce-policy.ts';

/** Document retains nodes, transforms, primitives, materials, skins and animation data. */
export interface IntermediateModel {
  document: Document;
  source: {
    path: string;
    format: 'obj' | 'gltf' | 'glb' | 'fbx' | 'dae' | 'stl' | 'ply' | 'pmx' | 'vrm' | 'ysm';
    units: 'meters' | 'unspecified';
    coordinates: 'right-handed-y-up' | 'unspecified';
    importer: 'gltf-transform' | 'libassimp' | 'ysm';
    backend?: 'native' | 'wasm';
    avatar?: { version: string; name?: string; authors?: string[]; license?: string };
    /** Importer suggestion for the texture pipeline; explicit user settings still win. */
    textureHint?: TextureHint;
    /** Importer default for triangle retention; explicit user settings still win. */
    reductionHint?: ReductionHint;
  };
  warnings: string[];
  preparation?: { snapshot: 'initial-pose'; worldTransformsBaked: true; scene: number };
}
