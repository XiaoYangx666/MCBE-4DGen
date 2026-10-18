import type { IntermediateModel } from './model.ts';
import { optimizeMesh } from './mesh-optimizer.ts';
import type { MeshOptions } from './mesh-optimizer.ts';
import { optimizeTextures } from './texture-optimizer.ts';
import type { TextureOptions } from './texture-optimizer.ts';
import { fitStaticModel, prepareStaticModel } from './prepare-model.ts';
import type { PrepareOptions } from './prepare-model.ts';

export interface PreparedOptimization { model: IntermediateModel; report: { preparation?: unknown; mesh: Awaited<ReturnType<typeof optimizeMesh>>["report"] } }

/** Generic optimization stage. No Minecraft coordinates, bone names or package rules here. */
export async function optimizeModel(input: IntermediateModel, options: { prepare?: PrepareOptions; mesh?: MeshOptions; texture?: TextureOptions; prepared?: PreparedOptimization; onPrepared?: (state:PreparedOptimization) => void } = {}) {
  if (options.prepared) {
    const texture = await optimizeTextures(options.prepared.model, options.texture);
    return {model:texture.model, atlas:texture.png, report:{...options.prepared.report, texture:texture.report}};
  }
  const prepared = options.prepare ? await prepareStaticModel(input, options.prepare.scene === undefined ? {} : { scene: options.prepare.scene }) : null;
  const mesh = await optimizeMesh(prepared?.model ?? input, options.mesh);
  const fitted = prepared ? await fitStaticModel(mesh.model, options.prepare) : null;
  const state: PreparedOptimization = {model:fitted?.model ?? mesh.model, report:{
    ...(prepared && fitted ? { preparation: { ...prepared.report, ...fitted.report, before: prepared.report.before, finalTriangles: mesh.report.after } } : {}), mesh:mesh.report}};
  options.onPrepared?.(state);
  const texture = await optimizeTextures(state.model, options.texture);
  return { model: texture.model, atlas: texture.png, report: {
    ...(prepared && fitted ? { preparation: { ...prepared.report, ...fitted.report, before: prepared.report.before, finalTriangles: mesh.report.after } } : {}),
    mesh: mesh.report, texture: texture.report } };
}
