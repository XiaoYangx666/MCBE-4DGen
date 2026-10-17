import type { IntermediateModel } from './model.ts';
import type { V3 } from './bedrock-types.ts';
import { validateModel } from './validate-model.ts';

export type PlayerBone = 'root' | 'body' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export interface StaticOptions {
  bone?: PlayerBone;
  /** Translation in the prepared model's right-handed, Y-up coordinates. */
  position?: V3;
  /** Rest-model pivot, in the same coordinates. Does not reposition the geometry. */
  pivot?: V3;
}
export interface StaticBinding {
  mode: 'static';
  model: IntermediateModel;
  meshBone: PlayerBone;
  position: V3;
  bones: { name: string; parent?: string; pivot: V3 }[];
}

/** Standard player pivots in the prepared model's coordinates; exporter mirrors X once. */
const skeleton: StaticBinding['bones'] = [
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'waist', parent: 'root', pivot: [0, 12, 0] },
  { name: 'body', parent: 'waist', pivot: [0, 24, 0] },
  { name: 'head', parent: 'body', pivot: [0, 24, 0] },
  { name: 'leftArm', parent: 'body', pivot: [-5, 22, 0] },
  { name: 'rightArm', parent: 'body', pivot: [5, 22, 0] },
  { name: 'leftLeg', parent: 'root', pivot: [-1.9, 12, 0] },
  { name: 'rightLeg', parent: 'root', pivot: [1.9, 12, 0] },
];

export function bindStatic(model: IntermediateModel, options: StaticOptions = {}): StaticBinding {
  validateModel(model);
  if (!model.preparation?.worldTransformsBaked || model.document.getRoot().listSkins().length) throw new Error('Static binding requires prepared rigid geometry');
  const root = model.document.getRoot();
  if (root.listAnimations().length) throw new Error('Static binding requires animation to be frozen');
  for (const node of root.listNodes()) {
    if (node.getMatrix().some((v, i) => v !== (i % 5 === 0 ? 1 : 0))) throw new Error('Static binding requires baked identity transforms');
  }
  const scene = root.getDefaultScene();
  if (!scene) throw new Error('Static binding requires a default scene');
  const instances: object[] = [];
  scene.traverse((node) => { if (node.getMesh()) instances.push(node.getMesh()!); });
  if (instances.length !== root.listMeshes().length || new Set(instances).size !== instances.length) throw new Error('Static binding requires expanded mesh instances and no orphan meshes');
  if (root.listMeshes().some((m) => m.listPrimitives().some((p) => p.listTargets().length))) throw new Error('Static binding requires morph targets to be frozen');
  const bone = options.bone ?? 'body';
  if (!['root', 'body', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(bone)) throw new Error('Unsupported player attachment bone');
  const position = options.position ?? [0, 0, 0];
  for (const value of [position, options.pivot]) {
    if (value && (value.length !== 3 || !value.every(Number.isFinite))) throw new Error('Static position and pivot require three finite numbers');
  }
  return { mode: 'static', model, meshBone: bone, position: [...position],
    bones: skeleton.map((b) => ({ ...b, pivot: [...(b.name === bone && options.pivot ? options.pivot : b.pivot)] })) };
}
