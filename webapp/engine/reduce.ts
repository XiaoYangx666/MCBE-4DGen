import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import type { SourceBatch } from './types.ts';

export interface ReduceOptions {
  /** Fraction of triangles to keep, 0.01–1. */
  ratio: number;
  /** Shape error budget; the desktop workbench default is 0.03. */
  maxError: number;
}

export interface ReduceDetail {
  name: string;
  before: number;
  after: number;
  error: number;
}

export interface ReduceResult {
  batches: SourceBatch[];
  before: number;
  after: number;
  details: ReduceDetail[];
  warnings: string[];
}

/**
 * Per-material simplification with meshoptimizer. Material boundaries stay
 * intact, matching the desktop workbench's rigid reduction, but weights are
 * fixed and only position/normal/UV are considered.
 */
export async function reduceBatches(
  batches: readonly SourceBatch[],
  options: ReduceOptions,
): Promise<ReduceResult> {
  if (!Number.isFinite(options.ratio) || options.ratio <= 0 || options.ratio > 1)
    throw new Error('保留面数比例需在 1%–100% 之间');
  if (!Number.isFinite(options.maxError) || options.maxError < 0)
    throw new Error('形状变化容限不能为负数');
  if (!MeshoptSimplifier.supported)
    throw new Error('当前浏览器不支持减面所需的 WebAssembly');
  await MeshoptSimplifier.ready;

  const output: SourceBatch[] = [];
  const details: ReduceDetail[] = [];
  const warnings: string[] = [];
  let before = 0;
  let after = 0;

  for (const batch of batches) {
    const triangles = batch.positions.length / 9;
    before += triangles;
    if (options.ratio >= 0.999 || triangles <= 1) {
      output.push(batch);
      after += triangles;
      continue;
    }
    try {
      const reduced = reduceBatch(batch, options);
      output.push(reduced.batch);
      details.push(reduced.detail);
      after += reduced.detail.after;
      if (reduced.detail.after > reduced.detail.before * options.ratio * 1.15) {
        warnings.push(
          `材质「${batch.name}」受形状容限限制，实际保留 ${Math.round((reduced.detail.after / reduced.detail.before) * 100)}% 面数。`,
        );
      }
    } catch (cause) {
      // Keep the original material instead of dropping a whole skin region.
      warnings.push(
        `材质「${batch.name}」减面失败，已保留原始面数：${cause instanceof Error ? cause.message : String(cause)}`,
      );
      output.push(batch);
      after += triangles;
    }
  }

  if (details.length) {
    warnings.push(
      `减面：${Math.round(before).toLocaleString('zh-CN')} → ${Math.round(after).toLocaleString('zh-CN')} 面（保留 ${Math.round((after / Math.max(1, before)) * 100)}%）。`,
    );
  }
  return { batches: output, before, after, details, warnings };
}

function reduceBatch(batch: SourceBatch, options: ReduceOptions) {
  if (batch.parts?.length) return reduceParts(batch, options);
  return simplifyBatch(batch, options);
}

/** Reduce each player part independently so no triangle crosses a bone seam. */
function reduceParts(batch: SourceBatch, options: ReduceOptions) {
  const triangles = batch.positions.length / 9;
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    const part = batch.parts?.[t] ?? 0;
    const list = groups.get(part);
    if (list) list.push(t);
    else groups.set(part, [t]);
  }
  if (groups.size <= 1) {
    const simplified = simplifyBatch(batch, options);
    const part = groups.keys().next().value ?? 0;
    return {
      batch: {
        ...simplified.batch,
        parts: new Uint8Array(simplified.detail.after).fill(part),
      },
      detail: simplified.detail,
    };
  }

  const positionChunks: Float32Array[] = [];
  const normalChunks: Float32Array[] = [];
  const uvChunks: Float32Array[] = [];
  const partChunks: Uint8Array[] = [];
  let before = 0;
  let after = 0;
  let error = 0;
  for (const [part, list] of groups) {
    const simplified = simplifyBatch(sliceTriangles(batch, list, part), options);
    positionChunks.push(simplified.batch.positions);
    normalChunks.push(simplified.batch.normals);
    if (simplified.batch.uvs) uvChunks.push(simplified.batch.uvs);
    partChunks.push(new Uint8Array(simplified.detail.after).fill(part));
    before += simplified.detail.before;
    after += simplified.detail.after;
    error = Math.max(error, simplified.detail.error);
  }
  const merged = mergeFloat(positionChunks);
  return {
    batch: {
      ...batch,
      positions: merged,
      normals: mergeFloat(normalChunks),
      uvs: batch.uvs ? mergeFloat(uvChunks) : null,
      parts: mergeBytes(partChunks),
      triangles: after,
      area: surfaceArea(merged),
    },
    detail: { name: batch.name, before, after, error },
  };
}

function mergeFloat(chunks: readonly Float32Array[]) {
  const output = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function mergeBytes(chunks: readonly Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function sliceTriangles(batch: SourceBatch, indices: readonly number[], part: number) {
  const positions = new Float32Array(indices.length * 9);
  const normals = new Float32Array(indices.length * 9);
  const uvs = batch.uvs ? new Float32Array(indices.length * 6) : null;
  let p = 0, n = 0, u = 0;
  for (const t of indices) {
    positions.set(batch.positions.subarray(t * 9, t * 9 + 9), p);
    normals.set(batch.normals.subarray(t * 9, t * 9 + 9), n);
    if (uvs && batch.uvs) uvs.set(batch.uvs.subarray(t * 6, t * 6 + 6), u);
    p += 9; n += 9; u += 6;
  }
  return {
    ...batch,
    positions,
    normals,
    uvs,
    parts: new Uint8Array(indices.length).fill(part),
    triangles: indices.length,
    area: surfaceArea(positions),
  };
}

function simplifyBatch(batch: SourceBatch, options: ReduceOptions) {
  const welded = weld(batch);
  const triangles = batch.positions.length / 9;
  const target = Math.max(1, Math.round(triangles * options.ratio));
  const attributes = new Float32Array((welded.positions.length / 3) * 5);
  const hasUvs = !!batch.uvs;
  for (let i = 0; i < welded.positions.length / 3; i++) {
    attributes[i * 5] = welded.normals[i * 3]!;
    attributes[i * 5 + 1] = welded.normals[i * 3 + 1]!;
    attributes[i * 5 + 2] = welded.normals[i * 3 + 2]!;
    attributes[i * 5 + 3] = hasUvs ? welded.uvs[i * 2]! : 0;
    attributes[i * 5 + 4] = hasUvs ? welded.uvs[i * 2 + 1]! : 0;
  }

  const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
    welded.indices,
    welded.positions,
    3,
    attributes,
    5,
    [0.25, 0.25, 0.25, hasUvs ? 1 : 0, hasUvs ? 1 : 0],
    null,
    target * 3,
    options.maxError,
    ['Permissive'],
  );
  if (!indices.length) throw new Error('减面后没有剩余三角面');

  const count = indices.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = hasUvs ? new Float32Array(count * 2) : null;
  for (let i = 0; i < count; i++) {
    const source = indices[i]!;
    positions[i * 3] = welded.positions[source * 3]!;
    positions[i * 3 + 1] = welded.positions[source * 3 + 1]!;
    positions[i * 3 + 2] = welded.positions[source * 3 + 2]!;
    normals[i * 3] = welded.normals[source * 3]!;
    normals[i * 3 + 1] = welded.normals[source * 3 + 1]!;
    normals[i * 3 + 2] = welded.normals[source * 3 + 2]!;
    if (uvs) {
      uvs[i * 2] = welded.uvs[source * 2]!;
      uvs[i * 2 + 1] = welded.uvs[source * 2 + 1]!;
    }
  }

  const { parts: _parts, ...rest } = batch;
  return {
    batch: {
      ...rest,
      positions,
      normals,
      uvs,
      triangles: count / 3,
      area: surfaceArea(positions),
    },
    detail: { name: batch.name, before: triangles, after: count / 3, error },
  };
}

/** Collapse exact duplicate corners so the simplifier sees shared edges. */
function weld(batch: SourceBatch) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices = new Uint32Array(batch.positions.length / 3);
  const lookup = new Map<string, number>();
  const hasUvs = !!batch.uvs;

  for (let i = 0; i < batch.positions.length / 3; i++) {
    const px = batch.positions[i * 3]!, py = batch.positions[i * 3 + 1]!, pz = batch.positions[i * 3 + 2]!;
    const nx = batch.normals[i * 3]!, ny = batch.normals[i * 3 + 1]!, nz = batch.normals[i * 3 + 2]!;
    const u = hasUvs ? batch.uvs![i * 2]! : 0;
    const v = hasUvs ? batch.uvs![i * 2 + 1]! : 0;
    const key = `${px},${py},${pz}|${nx},${ny},${nz}|${u},${v}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      positions.push(px, py, pz);
      normals.push(nx, ny, nz);
      uvs.push(u, v);
      lookup.set(key, index);
    }
    indices[i] = index;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices,
  };
}

function surfaceArea(positions: Float32Array): number {
  let area = 0;
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ux = positions[i + 3]! - positions[i]!;
    const uy = positions[i + 4]! - positions[i + 1]!;
    const uz = positions[i + 5]! - positions[i + 2]!;
    const vx = positions[i + 6]! - positions[i]!;
    const vy = positions[i + 7]! - positions[i + 1]!;
    const vz = positions[i + 8]! - positions[i + 2]!;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}
