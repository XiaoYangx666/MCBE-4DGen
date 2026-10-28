/**
 * Part-level filtering for browser batches.
 *
 * `extractModel` records one part id per triangle (`sourceParts`) because a
 * single material batch can contain several mesh instances or material groups.
 * Filtering drops triangles only; the material/sampler identity of the batch is
 * preserved, so other parts using the same material keep working.
 */
import type { SourceBatch } from './types.ts';
import type { ExtractedModel } from './extract.ts';

export interface BatchPart {
  id: string;
  name: string;
}

export function batchParts(batch: SourceBatch): BatchPart[] {
  return batch.sourcePartTable ?? [];
}

/** Parts that actually own triangles in this batch. */
export function usedBatchParts(batch: SourceBatch): BatchPart[] {
  const table = batch.sourcePartTable;
  const parts = batch.sourceParts;
  if (!table || !parts) return [];
  const used = new Set(parts);
  const result: BatchPart[] = [];
  table.forEach((part, index) => {
    if (used.has(index)) result.push(part);
  });
  return result;
}

/** Every part that owns at least one triangle, grouped by material batch. */
export interface ExtractedPart extends BatchPart {
  materialKey: string;
  materialName: string;
  triangles: number;
}

export function extractedParts(extracted: ExtractedModel): ExtractedPart[] {
  const result: ExtractedPart[] = [];
  for (const batch of extracted.batches) {
    const parts = usedBatchParts(batch);
    if (!parts.length) continue;
    const counts = new Map<string, number>();
    const table = batch.sourcePartTable;
    if (table && batch.sourceParts)
      for (const index of batch.sourceParts) {
        const part = table[index];
        if (part) counts.set(part.id, (counts.get(part.id) ?? 0) + 1);
      }
    for (const part of parts)
      result.push({
        ...part,
        materialKey: batch.key,
        materialName: batch.name,
        triangles: counts.get(part.id) ?? 0,
      });
  }
  return result;
}

/**
 * Keep only triangles whose part id is in `keep`. Returns null when the batch
 * loses every triangle. Batches without part metadata are returned untouched.
 */
export function filterBatchParts(
  batch: SourceBatch,
  keep: ReadonlySet<string>,
): SourceBatch | null {
  const table = batch.sourcePartTable;
  const parts = batch.sourceParts;
  if (!table || !parts) return batch;

  const keepIndex = new Set<number>();
  table.forEach((part, index) => {
    if (keep.has(part.id)) keepIndex.add(index);
  });
  if (!keepIndex.size) return null;

  let keptTriangles = 0;
  for (const part of parts) if (keepIndex.has(part)) keptTriangles++;
  if (!keptTriangles) return null;
  if (keptTriangles === parts.length) return batch;

  const positions = new Float32Array(keptTriangles * 9);
  const normals = new Float32Array(keptTriangles * 9);
  const uvs = batch.uvs ? new Float32Array(keptTriangles * 6) : null;
  const humanoid = batch.parts ? new Uint8Array(keptTriangles) : null;
  const sourceParts = new Uint16Array(keptTriangles);
  const newTable: BatchPart[] = [];
  const remap = new Map<number, number>();

  let area = 0;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  let cursor = 0;

  for (let t = 0; t < parts.length; t++) {
    const partIndex = parts[t]!;
    if (!keepIndex.has(partIndex)) continue;
    let mapped = remap.get(partIndex);
    if (mapped === undefined) {
      mapped = newTable.length;
      remap.set(partIndex, mapped);
      newTable.push(table[partIndex] ?? { id: `p${partIndex}`, name: `part${partIndex}` });
    }
    sourceParts[cursor] = mapped;

    const p = t * 9;
    positions.set(batch.positions.subarray(p, p + 9), cursor * 9);
    normals.set(batch.normals.subarray(p, p + 9), cursor * 9);
    if (uvs && batch.uvs) {
      uvs.set(batch.uvs.subarray(t * 6, t * 6 + 6), cursor * 6);
      for (let corner = 0; corner < 3; corner++) {
        const u = batch.uvs[t * 6 + corner * 2]!;
        const v = batch.uvs[t * 6 + corner * 2 + 1]!;
        if (u < minU) minU = u;
        if (v < minV) minV = v;
        if (u > maxU) maxU = u;
        if (v > maxV) maxV = v;
      }
    }
    if (humanoid && batch.parts) humanoid[cursor] = batch.parts[t] ?? 0;

    const ax = batch.positions[p]!;
    const ay = batch.positions[p + 1]!;
    const az = batch.positions[p + 2]!;
    const ux = batch.positions[p + 3]! - ax;
    const uy = batch.positions[p + 4]! - ay;
    const uz = batch.positions[p + 5]! - az;
    const vx = batch.positions[p + 6]! - ax;
    const vy = batch.positions[p + 7]! - ay;
    const vz = batch.positions[p + 8]! - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    cursor++;
  }

  const bounds: [number, number, number, number] | null =
    Number.isFinite(minU) && maxU - minU > 1e-6 && maxV - minV > 1e-6
      ? [minU, minV, maxU, maxV]
      : null;

  return {
    ...batch,
    positions,
    normals,
    uvs,
    area,
    triangles: keptTriangles,
    uvBounds: bounds,
    sourceParts,
    sourcePartTable: newTable,
    ...(humanoid ? { parts: humanoid } : {}),
  };
}
