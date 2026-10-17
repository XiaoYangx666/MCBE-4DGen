import type { IntermediateModel } from './model.ts';
import { optimizeMesh } from './mesh-optimizer.ts';
import type { MeshOptions } from './mesh-optimizer.ts';
import { optimizeTextures } from './texture-optimizer.ts';
import type { TextureOptions } from './texture-optimizer.ts';
import { fitStaticModel, prepareStaticModel } from './prepare-model.ts';
import type { PrepareOptions } from './prepare-model.ts';

/** Generic optimization stage. No Minecraft coordinates, bone names or package rules here. */
export async function optimizeModel(input: IntermediateModel, options: { prepare?: PrepareOptions; mesh?: MeshOptions; texture?: TextureOptions } = {}) {
  const prepared = options.prepare ? await prepareStaticModel(input, options.prepare.scene === undefined ? {} : { scene: options.prepare.scene }) : null;
  const mesh = await optimizeMesh(prepared?.model ?? input, options.mesh);
  const fitted = prepared ? await fitStaticModel(mesh.model, options.prepare) : null;
  const texture = await optimizeTextures(fitted?.model ?? mesh.model, options.texture);
  return { model: texture.model, atlas: texture.png, report: {
    ...(prepared && fitted ? { preparation: { ...prepared.report, ...fitted.report, before: prepared.report.before, finalTriangles: mesh.report.after } } : {}),
    mesh: mesh.report, texture: texture.report } };
}
