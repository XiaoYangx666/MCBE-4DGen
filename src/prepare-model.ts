import { getBounds } from '@gltf-transform/core';
import type { Document, Node, Primitive, mat4 as CoreMatrix, vec3 as Vector } from '@gltf-transform/core';
import { cloneDocument, compactPrimitive, transformPrimitive } from '@gltf-transform/functions';
import { mat3, mat4, vec3 } from 'gl-matrix';
import type { IntermediateModel } from './model.ts';
import { validateModel } from './validate-model.ts';

export interface PrepareOptions {
  scale?: number | Vector;
  /** Degrees, applied X, then Y, then Z, around source world origin. */
  rotation?: Vector;
  translation?: Vector;
  height?: number;
  center?: 'none' | 'ground' | 'bounds';
  scene?: number;
}

const coreMatrix = (m: mat4): CoreMatrix => Array.from(m) as CoreMatrix;
function vector(value: Vector, name: string): Vector {
  if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${name} must contain three finite numbers`);
  return value;
}

function data(p: Primitive, semantic: string): Float32Array<ArrayBuffer> | null {
  const a = p.getAttribute(semantic);
  if (!a) return null;
  const result = new Float32Array(a.getCount() * a.getElementSize());
  const v: number[] = [];
  for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); result.set(v, i * a.getElementSize()); }
  return result;
}

function setData(p: Primitive, doc: Document, semantic: string, values: Float32Array<ArrayBuffer>) {
  const type = semantic === 'TANGENT' ? 'VEC4' : 'VEC3';
  p.setAttribute(semantic, doc.createAccessor().setType(type).setArray(values).setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer()));
}

/** Evaluate initial morph weights before skinning, without mutating source accessors or targets. */
function morph(source: Primitive, node: Node, semantic: string): Float32Array<ArrayBuffer> | null {
  const result = data(source, semantic);
  const targets = source.listTargets();
  if (!result) {
    if (targets.some((target) => target.getAttribute(semantic))) throw new Error(`Morph target requires base ${semantic}`);
    return null;
  }
  const n = source.getAttribute('POSITION')!.getCount(), stride = source.getAttribute(semantic)!.getElementSize();
  const weights = node.getWeights().length ? node.getWeights() : node.getMesh()!.getWeights();
  if (weights.length && weights.length !== targets.length) throw new Error('Morph weight count does not match targets');
  for (let t = 0; t < targets.length; t++) {
    const weight = weights[t] ?? 0;
    if (!Number.isFinite(weight)) throw new Error('Non-finite morph weight');
    const a = targets[t]!.getAttribute(semantic);
    if (!a || !weight) continue;
    if (a.getCount() !== n || a.getType() !== 'VEC3') throw new Error(`Invalid morph ${semantic} accessor`);
    const delta: number[] = [];
    for (let i = 0; i < n; i++) {
      a.getElement(i, delta);
      if (!delta.every(Number.isFinite)) throw new Error('Non-finite morph delta');
      for (let c = 0; c < 3; c++) result[i * stride + c] = result[i * stride + c]! + weight * delta[c]!;
    }
  }
  return result;
}

/** Blended skin matrix per vertex, accumulated in a fixed order. Shared so the
 * bounds-only measurement below cannot drift from the real freeze. */
function skinSetup(jointMatrices: mat4[], sets: { joints: Int32Array; weights: Float32Array; jointSize: number }[]) {
  const blend = mat4.create();
  const jointBuffer: number[] = [];
  const weightBuffer: number[] = [];
  const signature: string[] = [];
  return function blendAt(i: number): { blend: mat4; sum: number; signatureKey: string } {
    for (let k = 0; k < 16; k++) blend[k] = 0;
    let sum = 0;
    signature.length = 0;
    for (const set of sets) {
      const base = i * set.jointSize;
      for (let c = 0; c < set.jointSize; c++) {
        jointBuffer[c] = set.joints[base + c]!;
        weightBuffer[c] = set.weights[base + c]!;
      }
      signature.push(jointBuffer.join(','), weightBuffer.join(','));
      for (let c = 0; c < set.jointSize; c++) {
        const weight = weightBuffer[c]!;
        const joint = jointBuffer[c]!;
        if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(joint) || !jointMatrices[joint]) throw new Error('Invalid skin influence');
        sum += weight;
        const m = jointMatrices[joint]!;
        for (let k = 0; k < 16; k++) blend[k] = blend[k]! + weight * m[k]!;
      }
    }
    return { blend, sum, signatureKey: signature.join('|') };
  };
}

function jointMatricesFor(node: Node) {
  const skin = node.getSkin()!;
  const joints = skin.listJoints(), inverse = skin.getInverseBindMatrices();
  return joints.map((joint, i) => {
    const bind = mat4.create();
    if (inverse) { const values: number[] = []; inverse.getElement(i, values); mat4.copy(bind, values); }
    return mat4.multiply(mat4.create(), joint.getWorldMatrix(), bind);
  });
}


function snapshotPrimitive(doc: Document, source: Primitive, node: Node, warn: (s: string) => void): Primitive {
  const out = doc.createPrimitive().setMode(4).setMaterial(source.getMaterial()).setExtras({ ...source.getExtras() });
  for (const semantic of source.listSemantics()) {
    if (['POSITION', 'NORMAL', 'TANGENT'].includes(semantic)) continue;
    out.setAttribute(semantic, source.getAttribute(semantic)!.clone());
  }
  for (const semantic of ['POSITION', 'NORMAL', 'TANGENT']) {
    const values = morph(source, node, semantic);
    if (values) setData(out, doc, semantic, values);
  }
  const indices = source.getIndices();
  if (indices) out.setIndices(indices.clone().setArray(new Uint32Array(indices.getArray()!)));
  compactPrimitive(out);
  const skin = node.getSkin();
  if (!skin) {
    const matrix = node.getWorldMatrix();
    if (!Number.isFinite(mat4.determinant(matrix)) || mat4.determinant(matrix) === 0) throw new Error('Cannot bake singular node transform');
    for (const s of out.listSemantics().filter((s) => /^(JOINTS|WEIGHTS)_\d+$/.test(s))) out.setAttribute(s, null);
    transformPrimitive(out, matrix); // Inverse-transpose normals and mirrored winding handled by the library.
    return out;
  }
  // glTF skin transform in world space is jointWorld * inverseBind, not meshWorld * jointWorld.
  const jointMatrices = jointMatricesFor(node);
  const compactSets = out.listSemantics().filter((s) => /^JOINTS_\d+$/.test(s)).sort().map((s) => ({
    joints: out.getAttribute(s)!, weights: out.getAttribute(s.replace('JOINTS_', 'WEIGHTS_'))!,
  }));
  const pos = data(out, 'POSITION')!, normal = data(out, 'NORMAL'), tangent = data(out, 'TANGENT');
  const regionIds = new Map<string, number>(), regions = new Float32Array(pos.length / 3);
  let renormalized = false;
  // Hoisted out of the per-vertex loop. This runs once per vertex of every
  // primitive (hundreds of thousands for a full character); allocating a mat4,
  // two arrays and joined strings per vertex dominated the freeze cost.
  const v = vec3.create();
  const normalMatrix = mat3.create();
  const tangentMatrix = mat3.create();
  // Accessor.getElement re-resolves size/type/array on every call, so read the
  // flat arrays directly. Values are identical: JOINTS_n are integer scalars and
  // WEIGHTS_n floats, the only component types the exporter emits.
  const sets = compactSets.map((set) => {
    const jointSize = set.joints.getElementSize();
    return { joints: new Int32Array(set.joints.getArray()!), weights: new Float32Array(set.weights.getArray()!), jointSize };
  });
  const blendAt = skinSetup(jointMatrices, sets);
  for (let i = 0; i < pos.length / 3; i++) {
    const { blend, sum, signatureKey } = blendAt(i);
    if (!regionIds.has(signatureKey)) regionIds.set(signatureKey, regionIds.size);
    regions[i] = regionIds.get(signatureKey)!;
    if (!(sum > 0) || !Number.isFinite(sum)) throw new Error('Vertex has no valid skin influence');
    if (Math.abs(sum - 1) > 1e-5) renormalized = true;
    for (let k = 0; k < 16; k++) blend[k] = blend[k]! / sum;
    const determinant = mat4.determinant(blend);
    if (!Number.isFinite(determinant) || !(determinant > 0)) throw new Error('Reflected or singular blended skin transform is not supported');
    vec3.set(v, pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    vec3.transformMat4(v, v, blend); pos.set(v, i * 3);
    if (normal) {
      if (!mat3.normalFromMat4(normalMatrix, blend)) throw new Error('Singular skin normal matrix');
      vec3.set(v, normal[i * 3]!, normal[i * 3 + 1]!, normal[i * 3 + 2]!);
      vec3.transformMat3(v, v, normalMatrix); vec3.normalize(v, v); normal.set(v, i * 3);
    }
    if (tangent) {
      vec3.set(v, tangent[i * 4]!, tangent[i * 4 + 1]!, tangent[i * 4 + 2]!);
      vec3.transformMat3(v, v, mat3.fromMat4(tangentMatrix, blend)); vec3.normalize(v, v);
      tangent.set(v, i * 4);
    }
  }
  for (const s of out.listSemantics().filter((s) => /^(JOINTS|WEIGHTS)_\d+$/.test(s))) out.setAttribute(s, null);
  setData(out, doc, 'POSITION', pos);
  if (normal) setData(out, doc, 'NORMAL', normal);
  if (tangent) setData(out, doc, 'TANGENT', tangent);
  // Retain only an opaque influence-region label, so later simplification still protects
  // original bone/weight boundaries after the animated rig has been frozen away.
  out.setAttribute('_SOURCE_SKIN_REGION', doc.createAccessor().setType('SCALAR').setArray(regions)
    .setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer()));
  if (renormalized) warn('Skin weights were normalized while freezing the initial pose.');
  return out;
}

/**
 * Bounds of the frozen initial pose, without building a snapshot document.
 * humanoid.ts needs only the height scale to convert a source-space shoulder
 * outset into fitted units; a full prepareStaticModel there built and discarded
 * an entire copy of the rig. The freeze math is shared with snapshotPrimitive,
 * so the returned bounds are identical to getBounds() on a real snapshot.
 */
export function measureFrozenBounds(input: IntermediateModel, options: { scene?: number } = {}) {
  const root = input.document.getRoot();
  const scenes = root.listScenes();
  const selected = options.scene ?? Math.max(0, scenes.indexOf(root.getDefaultScene()!));
  if (!Number.isSafeInteger(selected) || !scenes[selected]) throw new Error('Selected scene does not exist');
  const instances: Node[] = [];
  scenes[selected]!.traverse((node) => { if (node.getMesh()) instances.push(node); });
  if (!instances.length) throw new Error('Selected scene contains no mesh instances');
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const v = vec3.create();
  for (const node of instances) {
    if (node.getExtension('EXT_mesh_gpu_instancing')) throw new Error('GPU instancing must be expanded before Static preparation');
    const mesh = node.getMesh()!;
    const skin = node.getSkin();
    if (!skin) {
      // Unskinned instances are baked by transformPrimitive on a world-space copy;
      // mirror that here by transforming each vertex with the same matrix.
      const matrix = node.getWorldMatrix();
      if (!Number.isFinite(mat4.determinant(matrix)) || mat4.determinant(matrix) === 0) throw new Error('Cannot bake singular node transform');
      for (const source of mesh.listPrimitives()) {
        const pos = data(source, 'POSITION')!;
        for (let i = 0; i < pos.length / 3; i++) {
          vec3.set(v, pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
          vec3.transformMat4(v, v, matrix);
          for (let c = 0; c < 3; c++) { if (v[c]! < min[c]!) min[c] = v[c]!; if (v[c]! > max[c]!) max[c] = v[c]!; }
        }
      }
      continue;
    }
    const jointMatrices = jointMatricesFor(node);
    for (const source of mesh.listPrimitives()) {
      const pos = data(source, 'POSITION')!;
      const sets = source.listSemantics().filter((s) => /^JOINTS_\d+$/.test(s)).sort().map((s) => {
        const joints = source.getAttribute(s)!;
        return {
          joints: new Int32Array(joints.getArray()!),
          weights: new Float32Array(source.getAttribute(s.replace('JOINTS_', 'WEIGHTS_'))!.getArray()!),
          jointSize: joints.getElementSize(),
        };
      });
      if (!sets.length) throw new Error('Skinned primitive requires JOINTS_0 and WEIGHTS_0 VEC4');
      const blendAt = skinSetup(jointMatrices, sets);
      for (let i = 0; i < pos.length / 3; i++) {
        const { blend, sum } = blendAt(i);
        if (!(sum > 0) || !Number.isFinite(sum)) throw new Error('Vertex has no valid skin influence');
        for (let k = 0; k < 16; k++) blend[k] = blend[k]! / sum;
        // Keep the same rejection as the real freeze so a reflected or singular
        // blend fails here with the same message, not later with a wrong scale.
        const determinant = mat4.determinant(blend);
        if (!Number.isFinite(determinant) || !(determinant > 0)) throw new Error('Reflected or singular blended skin transform is not supported');
        vec3.set(v, pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        vec3.transformMat4(v, v, blend);
        for (let c = 0; c < 3; c++) { if (v[c]! < min[c]!) min[c] = v[c]!; if (v[c]! > max[c]!) max[c] = v[c]!; }
      }
    }
  }
  return { min: min as [number, number, number], max: max as [number, number, number] };
}

/** Explicit initial-pose snapshot for the Static conversion path. Original rig remains in input. */
export async function prepareStaticModel(input: IntermediateModel, options: PrepareOptions = {}) {
  settings(options);
  validateModel(input);
  const model: IntermediateModel = { ...input, document: cloneDocument(input.document), source: { ...input.source }, warnings: [...input.warnings] };
  const doc = model.document, root = doc.getRoot(), warnings: string[] = [];
  const warn = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };
  const previous = { scenes: root.listScenes(), nodes: root.listNodes(), meshes: root.listMeshes(), skins: root.listSkins(), animations: root.listAnimations(), cameras: root.listCameras() };
  const selected = options.scene ?? Math.max(0, previous.scenes.indexOf(root.getDefaultScene()!));
  if (!Number.isSafeInteger(selected) || !previous.scenes[selected]) throw new Error('Selected scene does not exist');
  const scene = previous.scenes[selected]!, snapshot = doc.createScene('static-snapshot');
  const instances: Node[] = [];
  scene.traverse((node) => { if (node.getMesh()) instances.push(node); });
  if (!instances.length) throw new Error('Selected scene contains no mesh instances');
  const activeSkins = new Set(instances.map((n) => n.getSkin()).filter(Boolean)).size;
  const hasMorph = instances.some((n) => n.getMesh()!.listPrimitives().some((p) => p.listTargets().length));
  for (const node of instances) {
    if (node.getExtension('EXT_mesh_gpu_instancing')) throw new Error('GPU instancing must be expanded before Static preparation');
    const mesh = doc.createMesh(node.getMesh()!.getName());
    for (const source of node.getMesh()!.listPrimitives()) mesh.addPrimitive(snapshotPrimitive(doc, source, node, warn));
    snapshot.addChild(doc.createNode(node.getName()).setMesh(mesh));
  }
  root.setDefaultScene(snapshot);
  if (activeSkins) warn('Initial skin pose frozen to rigid geometry; original rig/weights remain only in the unmodified input.');
  if (previous.animations.length) warn('Animation clips were not evaluated; the file initial pose was frozen.');
  if (previous.scenes.length > 1) warn(`Only scene ${selected} was included in the static snapshot.`);
  if (hasMorph) warn('Initial morph weights were baked into rigid geometry.');
  for (const a of previous.animations) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); }
  for (const s of previous.skins) s.dispose();
  for (const s of previous.scenes) s.dispose();
  for (const n of previous.nodes) n.dispose();
  for (const m of previous.meshes) { for (const p of m.listPrimitives()) { for (const t of p.listTargets()) t.dispose(); p.dispose(); } m.dispose(); }
  for (const c of previous.cameras) c.dispose();
  const fit = fitGeometry(model, options);
  model.warnings.push(...warnings);
  model.preparation = { snapshot: 'initial-pose', worldTransformsBaked: true, scene: selected };
  validateModel(model);
  return { model, report: { scene: selected, instances: instances.length,
    triangles: root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0),
    frozenSkins: activeSkins, ...fit, warnings } };
}

function settings(options: Omit<PrepareOptions, 'scene'>) {
  const scaling: Vector = typeof options.scale === 'number' ? [options.scale, options.scale, options.scale] : options.scale ?? [1, 1, 1];
  vector(scaling, 'scale');
  if (scaling.some((v) => v === 0)) throw new Error('scale must be nonzero on every axis');
  const rotation = vector(options.rotation ?? [0, 0, 0], 'rotation');
  const translation = vector(options.translation ?? [0, 0, 0], 'translation');
  const center = options.center ?? 'none';
  if (!['none', 'ground', 'bounds'].includes(center)) throw new Error('Unknown centering mode');
  if (options.height !== undefined && (!Number.isFinite(options.height) || options.height <= 0)) throw new Error('height must be finite and positive');
  return { scaling, rotation, translation, center };
}

function fitGeometry(model: IntermediateModel, options: Omit<PrepareOptions, 'scene'>) {
  const { scaling, rotation, translation, center } = settings(options);
  const doc = model.document, root = doc.getRoot(), snapshot = root.getDefaultScene()!;
  const primitives = root.listMeshes().flatMap((m) => m.listPrimitives());
  const before = getBounds(snapshot);
  const matrix = mat4.create();
  // Post-multiplication yields Rz * Ry * Rx * S, so vertices see S, X, Y, Z.
  mat4.rotateZ(matrix, matrix, rotation[2] * Math.PI / 180);
  mat4.rotateY(matrix, matrix, rotation[1] * Math.PI / 180);
  mat4.rotateX(matrix, matrix, rotation[0] * Math.PI / 180);
  mat4.scale(matrix, matrix, scaling);
  if (!Number.isFinite(mat4.determinant(matrix)) || mat4.determinant(matrix) === 0) throw new Error('Scale/rotation cannot be represented as an invertible transform');
  for (const p of primitives) transformPrimitive(p, coreMatrix(matrix));
  const transformed = getBounds(snapshot), currentHeight = transformed.max[1] - transformed.min[1];
  if (options.height !== undefined && !(currentHeight > 0)) throw new Error('Cannot set height on a zero-height model');
  const heightScale = options.height === undefined ? 1 : options.height / currentHeight;
  const offset: Vector = [0, 0, 0];
  if (center !== 'none') {
    offset[0] = -(transformed.min[0] + transformed.max[0]) / 2 * heightScale;
    offset[2] = -(transformed.min[2] + transformed.max[2]) / 2 * heightScale;
    offset[1] = -(center === 'ground' ? transformed.min[1] : (transformed.min[1] + transformed.max[1]) / 2) * heightScale;
  }
  const final = mat4.fromTranslation(mat4.create(), vec3.add(vec3.create(), offset, translation));
  mat4.scale(final, final, [heightScale, heightScale, heightScale]);
  if (!Number.isFinite(mat4.determinant(final)) || mat4.determinant(final) === 0) throw new Error('Requested height cannot be represented as an invertible transform');
  for (const p of primitives) transformPrimitive(p, coreMatrix(final));
  for (const a of root.listAccessors()) if (a.listParents().length === 1) a.dispose();
  const after = getBounds(snapshot);
  if (![...after.min, ...after.max].every(Number.isFinite)) throw new Error('Preparation produced invalid bounds');
  return { before, after, heightScale, center };
}

/** Fit already frozen geometry after simplification, so the final height remains the requested height. */
export async function fitStaticModel(input: IntermediateModel, options: Omit<PrepareOptions, 'scene'> = {}) {
  validateModel(input);
  if (!input.preparation?.worldTransformsBaked || input.document.getRoot().listSkins().length) throw new Error('fitStaticModel requires prepared rigid geometry');
  for (const node of input.document.getRoot().listNodes()) {
    if (node.getMatrix().some((v, i) => v !== (i % 5 === 0 ? 1 : 0))) throw new Error('fitStaticModel requires identity node transforms');
  }
  const model: IntermediateModel = { ...input, document: cloneDocument(input.document), source: { ...input.source }, warnings: [...input.warnings] };
  const report = fitGeometry(model, options);
  validateModel(model);
  return { model, report };
}
