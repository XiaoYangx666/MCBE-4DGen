/**
 * End-to-end texture-studio validation on real models.
 *
 * Covers:
 * - part identity and independent deletion on real geometry with shared material
 * - duplicate display names remain distinct by key
 * - legacy vs budget mode output, report consistency and weights
 * - a complete static skin-pack export
 *
 * Usage: node scripts/checks/texture-studio-e2e.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cloneDocument } from '@gltf-transform/functions';
import sharp from 'sharp';
import type { IntermediateModel } from '../../src/model.ts';
import { importModel } from '../../src/importer.ts';
import {
  assignParts,
  filterMaterialKeys,
  filterParts,
  materialKeyMap,
} from '../../src/parts.ts';
import { optimizeTextures } from '../../src/texture-optimizer.ts';
import { optimizeModel } from '../../src/optimizer.ts';
import { bindStatic } from '../../src/bone-mapper.ts';
import { exportBedrockGeometry } from '../../src/bedrock-exporter.ts';
import { buildSkinPack } from '../../src/skin-pack-files.ts';

const ROOT = resolve('.');
const OUT = resolve('docs/research/texture-studio-v1');
const MODELS = {
  kati: resolve(ROOT, '.cache/diag/kati/model.glb'),
  shino: resolve(ROOT, 'video/remotion/public/models/shino-source.glb'),
  furina: resolve(ROOT, 'video/remotion/public/models/furina-source.glb'),
};
const BUDGET = {
  compactSize: 128,
  padding: 1,
  atlasBudget: 'texel-retention' as const,
};

const failures: string[] = [];
const results: Record<string, unknown> = {};
const assert = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};

const uvBounds = (model: IntermediateModel) => {
  let outside = 0;
  let vertices = 0;
  for (const mesh of model.document.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      const uv = primitive.getAttribute('TEXCOORD_0');
      if (!uv) continue;
      const value: number[] = [];
      for (let index = 0; index < uv.getCount(); index++) {
        uv.getElement(index, value);
        vertices++;
        if (
          (value[0] ?? 0) < -1e-6 ||
          (value[1] ?? 0) < -1e-6 ||
          (value[0] ?? 0) > 1 + 1e-6 ||
          (value[1] ?? 0) > 1 + 1e-6
        )
          outside++;
      }
    }
  return { vertices, outside };
};

const reportSummary = (result: Awaited<ReturnType<typeof optimizeTextures>>) => {
  const report = result.report as any;
  return {
    allocation: report.allocation,
    atlas: report.atlas,
    materials: report.materials.map((material: any) => ({
      key: material.key,
      name: material.name,
      pixels: material.pixels,
      uvPixels: material.uvPixels,
      sharedPixels: material.sharedPixels ?? null,
      uniquePixels: material.uniquePixels ?? null,
      rectPixels: material.rectPixels ?? null,
      wastePixels: material.wastePixels ?? null,
      atlasTexels: material.atlasTexels ?? null,
      floorCharts: material.floorCharts ?? null,
      targetArea: material.targetArea ?? null,
      actualArea: material.actualArea ?? null,
    })),
    regions: report.regions.length,
    shared: report.shared ?? null,
    parts: report.parts?.length ?? 0,
    uv: uvBounds(result.model),
  };
};

async function runBudget(
  model: IntermediateModel,
  target: 'texel-density' | 'texel-retention',
  extra: Partial<Parameters<typeof optimizeTextures>[1]> = {},
) {
  const started = performance.now();
  const result = await optimizeTextures(model, {
    compactSize: 128,
    padding: 1,
    atlasBudget: target,
    ...extra,
  });
  return {
    result,
    elapsedMs: Math.round(performance.now() - started),
  };
}

async function inspectModel(path: string) {
  const model = await importModel(path);
  const parts = assignParts(model.document);
  const keys = materialKeyMap(model.document);
  const groups = new Map<string, typeof parts>();
  for (const part of parts) {
    const list = groups.get(part.materialKey) ?? [];
    list.push(part);
    groups.set(part.materialKey, list);
  }
  const shared = [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  return { model, parts, keys, groups, shared };
}

async function validateSharedDeletion(path: string) {
  const { model, parts, shared } = await inspectModel(path);
  const { result: baseline } = await runBudget(model, 'texel-retention');
  const baselineSummary = reportSummary(baseline);
  const group = [...shared].sort(
    (a, b) =>
      b[1].reduce((sum, part) => sum + part.triangles, 0) -
      a[1].reduce((sum, part) => sum + part.triangles, 0),
  )[0];
  if (!group) return { skipped: 'no shared material group' };
  const [materialKey, members] = group;
  const removedPart = [...members].sort((a, b) => b.triangles - a.triangles)[0]!;
  const keptIds = new Set(parts.map((part) => part.id));
  keptIds.delete(removedPart.id);

  // Snapshot a surviving primitive that shares the material.
  const survivor = members.find((part) => part.id !== removedPart.id)!;
  const survivorBefore = (() => {
    const node = model.document
      .getRoot()
      .listNodes()
      .filter((node) => node.getMesh())[survivor.nodeIndex]!;
    const mesh = node.getMesh()!;
    const primitive = mesh.listPrimitives()[survivor.primitive]!;
    const uv = primitive.getAttribute('TEXCOORD_0')!;
    const values: number[] = [];
    for (let index = 0; index < uv.getCount(); index++) {
      const value: number[] = [];
      uv.getElement(index, value);
      values.push(value[0]!, value[1]!);
    }
    return {
      material: primitive.getMaterial(),
      materialName: primitive.getMaterial()?.getName(),
      uv: values,
    };
  })();

  const copy = {
    ...model,
    document: cloneDocument(model.document),
    source: { ...model.source },
    warnings: [...model.warnings],
  };
  const filtered = filterParts(copy.document, keptIds);
  const remaining = assignParts(copy.document);
  const survivorAfter = (() => {
    const node = copy.document
      .getRoot()
      .listNodes()
      .filter((node) => node.getMesh())[survivor.nodeIndex]!;
    const mesh = node.getMesh()!;
    const primitive = mesh.listPrimitives()[survivor.primitive]!;
    const uv = primitive.getAttribute('TEXCOORD_0')!;
    const values: number[] = [];
    for (let index = 0; index < uv.getCount(); index++) {
      const value: number[] = [];
      uv.getElement(index, value);
      values.push(value[0]!, value[1]!);
    }
    return {
      material: primitive.getMaterial(),
      materialName: primitive.getMaterial()?.getName(),
      uv: values,
    };
  })();
  const { result: deleted } = await runBudget(copy, 'texel-retention');
  const deletedSummary = reportSummary(deleted);
  const deletedKeys = new Set(
    (deleted.report as any).materials.map((material: any) => material.key),
  );

  assert(filtered.removed.length === 1, 'part deletion removed more than one part');
  assert(
    remaining.some((part) => part.id === survivor.id),
    'part sharing the material was removed',
  );
  assert(
    survivorAfter.materialName === survivorBefore.materialName,
    'surviving primitive material changed',
  );
  assert(
    survivorAfter.uv.length === survivorBefore.uv.length &&
      survivorAfter.uv.every((value, index) => value === survivorBefore.uv[index]),
    'surviving primitive UVs changed',
  );
  // Removing demand frees budget, but the planner may grow the remaining charts
  // instead of shrinking the atlas. Content must stay in the same range.
  assert(
    Math.abs(
      deletedSummary.atlas.contentPixels! - baselineSummary.atlas.contentPixels!,
    ) <=
      baselineSummary.atlas.contentPixels! * 0.05,
    'deletion changed content beyond the reallocation range',
  );
  assert(
    deletedKeys.has(materialKey),
    'shared material disappeared after deleting one of its parts',
  );
  assert(
    ((deleted.report as any).parts?.length ?? 0) ===
      ((baseline.report as any).parts?.length ?? 0) - 1,
    'part report did not shrink',
  );

  return {
    materialKey,
    materialName: survivorBefore.materialName,
    removedPart: removedPart.name,
    removedTriangles: removedPart.triangles,
    removedPrimitives: filtered.removedPrimitives,
    removedMeshes: filtered.removedMeshes,
    removedNodes: filtered.removedNodes,
    keptPart: survivor.name,
    survivorUvUnchanged: true,
    survivorMaterialUnchanged: true,
    baseline: baselineSummary,
    afterDeletion: deletedSummary,
  };
}

async function validateDuplicateNames(path: string) {
  const { model, parts, keys } = await inspectModel(path);
  const copy = {
    ...model,
    document: cloneDocument(model.document),
    source: { ...model.source },
    warnings: [...model.warnings],
  };
  const partA = parts[0]!;
  const partB = parts.find((part) => part.materialKey !== partA.materialKey)!;
  const materialA = copy.document
    .getRoot()
    .listNodes()
    .filter((node) => node.getMesh())[partA.nodeIndex]!
    .getMesh()!
    .listPrimitives()[partA.primitive]!
    .getMaterial()!;
  const materialB = copy.document
    .getRoot()
    .listNodes()
    .filter((node) => node.getMesh())[partB.nodeIndex]!
    .getMesh()!
    .listPrimitives()[partB.primitive]!
    .getMaterial()!;
  materialA.setName('Duplicate');
  materialB.setName('Duplicate');
  const duplicateKeys = materialKeyMap(copy.document);
  const keyA = duplicateKeys.get(materialA)!;
  const keyB = duplicateKeys.get(materialB)!;
  const before = copy.document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .length;
  const removed = filterMaterialKeys(copy.document, new Set([keyB]));
  const after = copy.document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .length;
  const survivors = copy.document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives());
  assert(keyA !== keyB, 'duplicate names produced one key');
  assert(
    survivors.some((primitive) => primitive.getMaterial() === materialA),
    'duplicate-name filter removed the wrong material',
  );
  assert(
    !survivors.some((primitive) => primitive.getMaterial() === materialB),
    'excluded duplicate material still has primitives',
  );
  assert(after < before, 'duplicate-name filter removed no primitive');
  assert(removed.removedPrimitives > 0, 'filter report counted no primitives');
  return {
    keyA,
    keyB,
    removedPrimitives: removed.removedPrimitives,
    remainingPrimitives: after,
    removedMeshes: removed.removedMeshes,
  };
}

async function validateModesAndWeights(path: string) {
  const { model } = await inspectModel(path);
  const legacy = await optimizeTextures(model, { compactSize: 128, padding: 1 });
  const density = await runBudget(model, 'texel-density');
  const retention = await runBudget(model, 'texel-retention');
  const shared = await runBudget(model, 'texel-retention', { atlasSharing: true });
  const base = retention.result;
  const baseReport = base.report as any;
  const candidate = baseReport.materials.find(
    (material: any) => (material.floorCharts ?? 0) === 0 && (material.atlasTexels ?? 0) > 50,
  );
  const other = baseReport.materials.find(
    (material: any) =>
      material.key !== candidate?.key &&
      (material.floorCharts ?? 0) === 0 &&
      (material.atlasTexels ?? 0) > 20,
  );
  if (!candidate || !other)
    return { skipped: 'no material pair outside the technical floor' };

  const boosted = await runBudget(model, 'texel-retention', {
    materialWeights: { [candidate.key]: 4 },
  });
  const boostedReport = boosted.result.report as any;
  const boostedTarget = boostedReport.materials.find(
    (material: any) => material.key === candidate.key,
  )!;
  const boostedOther = boostedReport.materials.find(
    (material: any) => material.key === other.key,
  )!;
  const baseTarget = baseReport.materials.find(
    (material: any) => material.key === candidate.key,
  )!;
  const baseOther = baseReport.materials.find(
    (material: any) => material.key === other.key,
  )!;

  assert(boostedTarget.atlasTexels! > baseTarget.atlasTexels!, 'weight did not increase target pixels');
  assert(boostedOther.atlasTexels! < baseOther.atlasTexels!, 'weight did not reduce another material');
  assert(
    baseReport.materials.reduce((sum: number, material: any) => sum + material.rectPixels!, 0) ===
      baseReport.atlas.contentPixels!,
    'per-material attributed pixels do not sum to content',
  );
  assert(
    (density.result.report as any).materials.map((material: any) => material.key).sort().join(',') ===
      (retention.result.report as any).materials.map((material: any) => material.key).sort().join(','),
    'material keys changed between budget targets',
  );
  const sharedReport = shared.result.report as any;
  assert(
    sharedReport.atlas.sharedContentPixels! > 0 || sharedReport.shared?.charts === 0,
    'sharing report is inconsistent',
  );

  return {
    legacy: reportSummary(legacy),
    density: reportSummary(density.result),
    retention: reportSummary(retention.result),
    shared: reportSummary(shared.result),
    weightTest: {
      material: candidate.key,
      from: baseTarget.atlasTexels,
      to: boostedTarget.atlasTexels,
      other: other.key,
      otherFrom: baseOther.atlasTexels,
      otherTo: boostedOther.atlasTexels,
    },
    timings: {
      densityMs: density.elapsedMs,
      retentionMs: retention.elapsedMs,
      sharedMs: shared.elapsedMs,
    },
  };
}

async function validateExport(path: string) {
  const model = await importModel(path);
  const started = performance.now();
  const optimized = await optimizeModel(model, {
    prepare: { height: 32, center: 'ground' },
    mesh: { ratio: 0.2, maxError: 0.03 },
    texture: {
      compactSize: 128,
      padding: 1,
      atlasBudget: 'texel-retention',
      atlasSharing: true,
    },
  });
  const exported = await exportBedrockGeometry(bindStatic(optimized.model), {
    identifier: 'geometry.skin0',
    skinTextureSize: 128,
  });
  const files = buildSkinPack({
    geometry: exported.file,
    png: exported.png,
    identifier: 'geometry.skin0',
    packName: 'Texture Studio E2E',
  });
  const elapsedMs = Math.round(performance.now() - started);
  const names = Object.keys(files).sort();
  const geometry = exported.file['geometry.skin0'];
  assert(exported.png.length > 0, 'export produced an empty PNG');
  assert(
    names.some((name) => name.endsWith('manifest.json')) &&
      names.some((name) => name.endsWith('geometry.json')),
    'skin pack is missing manifest or geometry',
  );
  assert(!!geometry, 'skin pack geometry is missing');
  assert(exported.report.triangles > 0, 'export produced no triangles');
  return {
    elapsedMs,
    triangles: exported.report.triangles,
    files: names,
    textureBytes: exported.png.length,
    geometryBytes: geometry ? JSON.stringify(geometry).length : 0,
    report: optimized.report,
    png: exported.png,
  };
}

await mkdir(resolve(OUT, 'data'), { recursive: true });
await mkdir(resolve(OUT, 'images'), { recursive: true });

for (const [name, path] of Object.entries(MODELS)) {
  const started = performance.now();
  try {
    const { parts, shared, model } = await inspectModel(path);
    const summary: Record<string, unknown> = {
      parts: parts.length,
      instanceParts: parts.filter((part) => part.instancePart).length,
      materials: model.document.getRoot().listMaterials().length,
      sharedGroups: shared.map(([key, list]) => ({
        key,
        parts: list.length,
        triangles: list.reduce((sum, part) => sum + part.triangles, 0),
      })),
      modes: await validateModesAndWeights(path),
      duplicateNames: await validateDuplicateNames(path),
    };
    if (shared.length) summary.sharedDeletion = await validateSharedDeletion(path);
    if (name === 'kati') {
      const exported = await validateExport(path);
      await writeFile(
        resolve(OUT, 'images', 'kati-budget-export-atlas.png'),
        await sharp(Buffer.from(exported.png)).png().toBuffer(),
      );
      delete (exported as { png?: Uint8Array }).png;
      summary.export = exported;
    }
    summary.elapsedMs = Math.round(performance.now() - started);
    results[name] = summary;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    results[name] = { error: error instanceof Error ? error.message : String(error) };
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  models: results,
  failures,
};
await writeFile(resolve(OUT, 'data', 'e2e.json'), JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ failures, models: Object.keys(results) }, null, 2));
if (failures.length) process.exitCode = 1;
