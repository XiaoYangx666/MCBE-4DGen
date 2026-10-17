import type { IntermediateModel } from './model.ts';

/** Input sanity checks, separate from the future Bedrock output validator. */
export function validateModel(model: IntermediateModel): void {
  const root = model.document.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position || position.getType() !== 'VEC3' || !position.getCount()) throw new Error('Mesh requires non-empty VEC3 POSITION');
      if (primitive.getMode() !== 4) throw new Error(`Only triangle primitives are supported in this stage (mode ${primitive.getMode()})`);
      for (const [semantic, attribute] of primitive.listSemantics().map((s) => [s, primitive.getAttribute(s)] as const)) {
        if (!attribute || attribute.getCount() !== position.getCount()) throw new Error(`Invalid attribute count: ${semantic}`);
        const type = semantic === 'NORMAL' ? 'VEC3' : /^TEXCOORD_\d+$/.test(semantic) ? 'VEC2'
          : /^(JOINTS|WEIGHTS)_\d+$/.test(semantic) || semantic === 'TANGENT' ? 'VEC4' : null;
        if (type && attribute.getType() !== type) throw new Error(`Invalid attribute type: ${semantic} must be ${type}`);
        const array = attribute.getArray();
        if (!array || !array.every(Number.isFinite)) throw new Error(`Non-finite or missing attribute: ${semantic}`);
      }
      const indices = primitive.getIndices();
      const count = indices?.getCount() ?? position.getCount();
      if (count === 0 || count % 3) throw new Error('Triangle index count must be a positive multiple of three');
      if (indices) {
        if (indices.getType() !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.getComponentType())) throw new Error('Indices must be unsigned integer SCALAR');
        const array = indices.getArray();
        if (!array || !array.every((v) => Number.isInteger(v) && v >= 0 && v < position.getCount())) throw new Error('Index outside vertex range');
      }
      triangles += count / 3;
    }
  }
  if (!triangles) throw new Error('Model contains no triangles');
  for (const node of root.listNodes()) {
    if (!node.getMatrix().every(Number.isFinite)) throw new Error('Node has a non-finite transform');
    const ancestors = new Set([node]);
    let parent = node.getParentNode();
    while (parent) {
      if (ancestors.has(parent)) throw new Error('Cyclic node hierarchy');
      ancestors.add(parent);
      parent = parent.getParentNode();
    }
    const skin = node.getSkin();
    if (!skin) continue;
    const joints = skin.listJoints();
    if (!joints.length) throw new Error('Skin has no joints');
    const inverse = skin.getInverseBindMatrices();
    if (inverse && (inverse.getType() !== 'MAT4' || inverse.getCount() !== joints.length || !inverse.getArray()?.every(Number.isFinite))) throw new Error('Invalid inverse bind matrices');
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const joint = primitive.getAttribute('JOINTS_0');
      const weight = primitive.getAttribute('WEIGHTS_0');
      if (!joint || !weight || joint.getType() !== 'VEC4' || weight.getType() !== 'VEC4') throw new Error('Skinned primitive requires JOINTS_0 and WEIGHTS_0 VEC4');
      for (const semantic of primitive.listSemantics().filter((s) => /^JOINTS_\d+$/.test(s))) {
        const jointsAttribute = primitive.getAttribute(semantic)!;
        const weightsAttribute = primitive.getAttribute(semantic.replace('JOINTS_', 'WEIGHTS_'));
        if (!weightsAttribute) throw new Error(`Missing weights corresponding to ${semantic}`);
        if (!jointsAttribute.getArray()?.every((v) => Number.isInteger(v) && v >= 0 && v < joints.length)) throw new Error('Joint index outside skin range');
        if (!weightsAttribute.getArray()?.every((v) => v >= 0)) throw new Error('Skin weights must be nonnegative');
      }
    }
  }
}
