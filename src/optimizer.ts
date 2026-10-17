import type { IntermediateModel } from './model.ts';
import { optimizeMesh } from './mesh-optimizer.ts';
import type { MeshOptions } from './mesh-optimizer.ts';
import { optimizeTextures } from './texture-optimizer.ts';
import type { TextureOptions } from './texture-optimizer.ts';

/** Generic optimization stage. No Minecraft coordinates, bone names or package rules here. */
export async function optimizeModel(input: IntermediateModel, options: { mesh?: MeshOptions; texture?: TextureOptions } = {}) {
  const mesh = await optimizeMesh(input, options.mesh);
  const texture = await optimizeTextures(mesh.model, options.texture);
  return { model: texture.model, atlas: texture.png, report: { mesh: mesh.report, texture: texture.report } };
}
