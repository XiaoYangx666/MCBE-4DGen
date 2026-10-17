import type { Document, Primitive } from '@gltf-transform/core';
import { cloneDocument, compactPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { IntermediateModel } from './model.ts';
import { validateModel } from './validate-model.ts';

export interface MeshOptions {
  preset?: 'original' | 'high' | 'balanced' | 'performance';
  ratio?: number;
  triangles?: number;
  /** Relative to each primitive's Meshoptimizer scale, not a Hausdorff bound. */
  maxError?: number;
}

const presets = { original: 1, high: 0.75, balanced: 0.5, performance: 0.25 } as const;
const count = (p: Primitive) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;

function index(p: Primitive, doc: Document, values: Uint32Array): void {
  const previous = p.getIndices();
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(values))
    .setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer()));
  if (previous?.listParents().length === 1) previous.dispose();
}

function positions(p: Primitive): Float32Array {
  const accessor = p.getAttribute('POSITION')!;
  const result = new Float32Array(accessor.getCount() * 3);
  const v: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) { accessor.getElement(i, v); result.set(v, i * 3); }
  return result;
}

function clean(p: Primitive, doc: Document): number {
  const pos = positions(p);
  const src = p.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const dst: number[] = [];
  for (let i = 0; i < src.length; i += 3) {
    const a = src[i]!, b = src[i + 1]!, c = src[i + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!, uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!, uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!, vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!, vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    // Exact zero only: do not erase small but valid structures using a scale-dependent epsilon.
    if (a === b || b === c || a === c || nx * nx + ny * ny + nz * nz === 0) continue;
    dst.push(a, b, c);
  }
  index(p, doc, Uint32Array.from(dst));
  return (src.length - dst.length) / 3;
}

function addNormals(p: Primitive, doc: Document): boolean {
  if (p.getAttribute('NORMAL')) return false;
  const pos = positions(p);
  const normals = new Float32Array(pos.length);
  const indices = p.getIndices()!.getArray()!;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!, uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!, uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!, vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!, vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const vertex of [a, b, c]) for (let j = 0; j < 3; j++) normals[vertex * 3 + j] = normals[vertex * 3 + j]! + n[j]!;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (length) for (let j = 0; j < 3; j++) normals[i + j] = normals[i + j]! / length;
    else normals[i + 1] = 1; // Isolated or cancelling faces; deterministic finite fallback.
  }
  p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals)
    .setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer()));
  return true;
}

/** Lock small disconnected parts and all edges spanning distinct skin-influence signatures. */
function locks(p: Primitive, indices: Uint32Array, vertices: number): Uint8Array {
  const parent = Uint32Array.from({ length: vertices }, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) { parent[v] = parent[parent[v]!]!; v = parent[v]!; }
    return v;
  };
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]!);
    parent[find(indices[i + 1]!)] = root;
    parent[find(indices[i + 2]!)] = root;
  }
  const faces = new Uint32Array(vertices);
  for (let i = 0; i < indices.length; i += 3) { const root = find(indices[i]!); faces[root] = faces[root]! + 1; }
  const result = new Uint8Array(vertices);
  for (let i = 0; i < vertices; i++) if (faces[find(i)]! <= 12) result[i] = 1;
  const skin = p.listSemantics().filter((s) => /^(JOINTS|WEIGHTS)_\d+$/.test(s) || s === '_SOURCE_SKIN_REGION').sort();
  if (skin.length) {
    const signatures = Array.from({ length: vertices }, (_, i) => skin.map((s) => {
      const a = p.getAttribute(s)!, array = a.getArray()!, size = a.getElementSize();
      return Array.from(array.subarray(i * size, (i + 1) * size)).join(',');
    }).join('|'));
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
      if (signatures[a] !== signatures[b] || signatures[a] !== signatures[c]) result[a] = result[b] = result[c] = 1;
    }
  }
  return result;
}

function attributes(p: Primitive): { values: Float32Array; weights: number[] } {
  const selected = p.listSemantics().filter((s) => s === 'NORMAL' || /^TEXCOORD_\d+$/.test(s) || /^COLOR_\d+$/.test(s));
  const weights = selected.flatMap((s) => Array(p.getAttribute(s)!.getElementSize()).fill(s === 'NORMAL' ? 0.25 : 0.5) as number[]);
  const n = p.getAttribute('POSITION')!.getCount();
  const values = new Float32Array(n * weights.length);
  for (let i = 0; i < n; i++) {
    let offset = i * weights.length;
    for (const s of selected) {
      const element: number[] = [];
      p.getAttribute(s)!.getElement(i, element);
      values.set(element, offset); offset += element.length;
    }
  }
  return { values, weights };
}

export async function optimizeMesh(input: IntermediateModel, options: MeshOptions = {}) {
  const selectors = [options.preset !== undefined, options.ratio !== undefined, options.triangles !== undefined].filter(Boolean).length;
  if (selectors > 1) throw new Error('Choose only one of preset, ratio or triangles');
  if (options.preset !== undefined && !Object.hasOwn(presets, options.preset)) throw new Error('Unknown quality preset');
  if (options.ratio !== undefined && (!Number.isFinite(options.ratio) || options.ratio <= 0 || options.ratio > 1)) throw new Error('ratio must be in (0, 1]');
  if (options.triangles !== undefined && (!Number.isSafeInteger(options.triangles) || options.triangles < 1)) throw new Error('triangles must be a positive integer');
  const maxError = options.maxError ?? 0.001;
  if (!Number.isFinite(maxError) || maxError < 0) throw new Error('maxError must be finite and nonnegative');
  validateModel(input);
  await MeshoptSimplifier.ready;
  const model: IntermediateModel = { ...input, document: cloneDocument(input.document), source: { ...input.source }, warnings: [...input.warnings] };
  const doc = model.document;
  const initial = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const before = initial.reduce((n, p) => n + count(p), 0);
  let removedDegenerates = 0, generatedNormals = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    removedDegenerates += clean(p, doc);
    if (!count(p)) { mesh.removePrimitive(p); p.dispose(); continue; }
    compactPrimitive(p);
    if (addNormals(p, doc)) generatedNormals++;
    // Exact, per-primitive welding includes normals, UV, skin and morph data.
    weldPrimitive(p, { overwrite: true });
    compactPrimitive(p);
  }
  const primitives = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const cleaned = primitives.reduce((n, p) => n + count(p), 0);
  if (!cleaned) throw new Error('All triangles are degenerate; refusing to emit an empty model');
  const ratio = options.ratio ?? presets[options.preset ?? 'original'];
  const requested = Math.min(cleaned, options.triangles ?? Math.max(1, Math.floor(cleaned * ratio)));
  const target = Math.max(primitives.length, requested);
  const allocations = primitives.map((p) => Math.max(1, Math.floor(count(p) / cleaned * target)));
  let allocated = allocations.reduce((a, b) => a + b, 0);
  // Allocate residual budget without permitting any primitive to disappear.
  for (let i = 0; allocated !== target; i = (i + 1) % allocations.length) {
    if (allocated < target && allocations[i]! < count(primitives[i]!)) { allocations[i] = allocations[i]! + 1; allocated++; }
    else if (allocated > target && allocations[i]! > 1) { allocations[i] = allocations[i]! - 1; allocated--; }
  }
  const warnings: string[] = [];
  const details = primitives.map((p, id) => {
    const original = count(p), desired = allocations[id]!;
    let achievedError = 0;
    if (desired < original && p.listTargets().length) warnings.push(`Primitive ${id}: morph targets retained without simplification; deformation error is not modeled.`);
    else if (desired < original) {
      const pos = positions(p), indices = Uint32Array.from(p.getIndices()!.getArray()!);
      const attr = attributes(p);
      const [result, error] = MeshoptSimplifier.simplifyWithAttributes(indices, pos, 3, attr.values, attr.weights.length,
        attr.weights, locks(p, indices, pos.length / 3), desired * 3, maxError, ['LockBorder']);
      if (result.length === 0) throw new Error(`Simplifier removed primitive ${id}`);
      achievedError = error;
      index(p, doc, result);
      compactPrimitive(p);
    }
    const actual = count(p);
    if (actual > desired) warnings.push(`Primitive ${id}: requested ${desired} triangles, retained ${actual} to respect error/topology/UV/skin/detail constraints.`);
    return { id, before: original, target: desired, after: actual, achievedError };
  });
  const after = details.reduce((n, p) => n + p.after, 0);
  if (after > requested) warnings.push(`Requested ${requested} total triangles; retained ${after}. No forced destructive fallback was used.`);
  model.warnings.push(...warnings);
  validateModel(model);
  return { model, report: { before, afterCleanup: cleaned, after, target: requested,
    reductionPercent: (before - after) / before * 100, maxError, removedDegenerates, generatedNormals,
    primitives: details, warnings } };
}

export type MeshReport = Awaited<ReturnType<typeof optimizeMesh>>['report'];
