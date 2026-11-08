import { cloneDocument, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { IntermediateModel } from './model.ts';
import { optimizeMesh } from './mesh-optimizer.ts';
import { readPartExtra } from './parts.ts';
import {
  isValidReduceMaxError,
  isValidReduceRatio,
  partReduceRatio,
  REDUCE_ATTRIBUTE_WEIGHTS,
  REDUCE_SIMPLIFY_OPTIONS,
  type ReducePartRatios,
} from './reduce-policy.ts';
import { validateModel } from './validate-model.ts';

/** Opt-in, post-pose/per-material reduction. Keeps rigid ownership and material boundaries. */
export async function reduceRigidModel(
  input: IntermediateModel,
  options: { ratio: number; maxError: number; partRatios?: ReducePartRatios },
) {
  if (!isValidReduceRatio(options.ratio) || !isValidReduceMaxError(options.maxError)) throw new Error('Invalid rigid reduction options');
  if (!input.preparation?.worldTransformsBaked || input.document.getRoot().listSkins().length) throw new Error('Rigid reduction requires frozen geometry');
  const cloned = { ...input, document: cloneDocument(input.document), warnings: [...input.warnings] };
  let invisibleTriangles = 0;
  for (const mesh of cloned.document.getRoot().listMeshes()) for (const p of [...mesh.listPrimitives()]) {
    const material = p.getMaterial();
    if (material?.getAlphaMode() === 'BLEND' && material.getBaseColorFactor()[3] === 0) {
      invisibleTriangles += p.getIndices()!.getCount() / 3; mesh.removePrimitive(p); p.dispose(); continue;
    }
    p.setAttribute('_SOURCE_SKIN_REGION', null);
  }
  const cleaned = await optimizeMesh(cloned, { preset: 'original' });
  await MeshoptSimplifier.ready;
  const details = [];
  for (const mesh of cleaned.model.document.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const source = new Uint32Array(p.getIndices()!.getArray()!), pos = p.getAttribute('POSITION')!, normal = p.getAttribute('NORMAL')!, uv = p.getAttribute('TEXCOORD_0')!;
    const attributes = new Float32Array(pos.getCount() * 5);
    for (let i = 0; i < pos.getCount(); i++) { const n: number[] = [], t: number[] = []; normal.getElement(i, n); uv.getElement(i, t); attributes.set([...n, ...t], i * 5); }
    const sourcePart = readPartExtra(p.getExtras())?.id;
    const ratio = partReduceRatio(sourcePart, options.ratio, options.partRatios);
    const triangleCount = source.length / 3;
    const target = Math.max(1, Math.floor(triangleCount * ratio));
    // Requesting every triangle is a no-op; skip the simplifier so 100% parts
    // cost nothing when the user is only tuning other parts.
    if (target >= triangleCount) {
      details.push({ part: p.getExtras()._playerPart, sourcePart, material: p.getMaterial()?.getName(), before: triangleCount, after: triangleCount, error: 0 });
      continue;
    }
    const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(source, new Float32Array(pos.getArray()!), 3,
      attributes, 5, [...REDUCE_ATTRIBUTE_WEIGHTS], null, target * 3, options.maxError, [...REDUCE_SIMPLIFY_OPTIONS]);
    if (!indices.length) throw new Error('Reduction emptied a material/rigid group');
    details.push({ part: p.getExtras()._playerPart, sourcePart, material: p.getMaterial()?.getName(), before: source.length / 3, after: indices.length / 3, error });
    p.setIndices(cleaned.model.document.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(cleaned.model.document.getRoot().listBuffers()[0]!));
    compactPrimitive(p);
  }
  validateModel(cleaned.model);
  return { model: cleaned.model, report: { invisibleTriangles, before: cleaned.report.before + invisibleTriangles,
    after: details.reduce((sum, p) => sum + p.after, 0), ...options, details } };
}
