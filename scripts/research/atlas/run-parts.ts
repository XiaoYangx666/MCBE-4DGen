/**
 * Stage 2 experiment: part-level deletion on real geometry.
 *
 * For each model we construct the case that the corpus does not contain
 * naturally: two parts sharing one material.
 *
 *  - `instance`: a second node reuses the same mesh (same material, same UVs)
 *  - `uv-region`: a new mesh reuses the material but maps its triangles to a
 *    different UV quadrant of the same texture
 *
 * Then we prepare the model (one mesh per node instance), assign part ids,
 * remove the accessory part, and compare the retained part's end-to-end
 * sampling with the source texture before and after deletion.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Document, Material, Primitive } from '@gltf-transform/core';
import { importModel } from '../../../src/importer.ts';
import { prepareStaticModel } from '../../../src/prepare-model.ts';
import { optimizeTextures } from '../../../src/texture-optimizer.ts';
import { assignParts, filterParts, partDemands } from '../../../src/parts.ts';
import { bakeSample, sampleAtlasLinear, sampleBilinear } from './sample.ts';
import type { RgbaImage } from './types.ts';

const MODELS = process.env.PARTS_MODELS
  ? process.env.PARTS_MODELS.split(';').filter(Boolean)
  : [
      'video/remotion/public/models/shino-source.glb',
      'video/remotion/public/models/nana-source.glb',
      'video/remotion/public/models/furina-source.glb',
    ];

interface Captured {
  uvs: Float32Array;
  material: Material | null;
  triangles: number;
}

const key = (node: string, primitive: number) => `${node}/${primitive}`;

function capture(document: Document): Map<string, Captured> {
  const result = new Map<string, Captured>();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    mesh.listPrimitives().forEach((primitive, index) => {
      const uv = primitive.getAttribute('TEXCOORD_0');
      if (!uv) return;
      const values = new Float32Array(uv.getCount() * 2);
      const value: number[] = [];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, value);
        values[i * 2] = value[0] ?? 0;
        values[i * 2 + 1] = value[1] ?? 0;
      }
      const indices = primitive.getIndices();
      result.set(key(node.getName(), index), {
        uvs: values,
        material: primitive.getMaterial(),
        triangles: indices ? Math.floor(indices.getCount() / 3) : Math.floor(uv.getCount() / 3),
      });
    });
  }
  return result;
}

async function decode(image: Uint8Array): Promise<RgbaImage> {
  const { data, info } = await sharp(image)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    key: 'source',
  };
}

interface SampleReport {
  samples: number;
  meanAbs: number;
  p95: number;
}

async function measure(
  document: Document,
  captured: Map<string, Captured>,
  atlas: RgbaImage,
  size: number,
  parts: { node: string; primitive: number }[],
): Promise<SampleReport> {
  const cache = new Map<Material, RgbaImage | null>();
  const errors: number[] = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const [index, primitive] of mesh.listPrimitives().entries()) {
      if (!parts.some((part) => part.node === node.getName() && part.primitive === index))
        continue;
      const original = captured.get(key(node.getName(), index));
      const uv = primitive.getAttribute('TEXCOORD_0');
      if (!original || !uv) continue;
      const material = original.material;
      if (material && !cache.has(material)) {
        const image = material.getBaseColorTexture()?.getImage();
        cache.set(material, image ? await decode(image) : null);
      }
      const source = material ? cache.get(material) ?? null : null;
      const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const color: [number, number, number] = [
        linearToSrgb(factor[0]!),
        linearToSrgb(factor[1]!),
        linearToSrgb(factor[2]!),
      ];
      const alphaMode = material?.getAlphaMode() ?? 'OPAQUE';
      const cutoff = material?.getAlphaCutoff() ?? 0.5;
      const info = material?.getBaseColorTextureInfo();
      const wrapU = (info?.getWrapS() ?? 10497) === 33071 ? 'clamp' : (info?.getWrapS() ?? 10497) === 33648 ? 'mirror' : 'repeat';
      const wrapV = (info?.getWrapT() ?? 10497) === 33071 ? 'clamp' : (info?.getWrapT() ?? 10497) === 33648 ? 'mirror' : 'repeat';
      const indices = primitive.getIndices();
      const indexArray = indices?.getArray();
      const count = indices ? Math.floor(indices.getCount() / 3) : original.triangles;
      const mapped: number[] = [];
      const value: number[] = [];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, value);
        mapped.push(value[0] ?? 0, value[1] ?? 0);
      }
      const probes: [number, number, number][] = [
        [1 / 3, 1 / 3, 1 / 3],
        [0.6, 0.2, 0.2],
      ];
      for (let t = 0; t < count; t++) {
        const ids = [0, 1, 2].map((corner) =>
          indexArray ? indexArray[t * 3 + corner]! : t * 3 + corner,
        );
        for (const [w0, w1, w2] of probes) {
          const su =
            w0 * original.uvs[ids[0]! * 2]! +
            w1 * original.uvs[ids[1]! * 2]! +
            w2 * original.uvs[ids[2]! * 2]!;
          const sv =
            w0 * original.uvs[ids[0]! * 2 + 1]! +
            w1 * original.uvs[ids[1]! * 2 + 1]! +
            w2 * original.uvs[ids[2]! * 2 + 1]!;
          const au =
            w0 * mapped[ids[0]! * 2]! +
            w1 * mapped[ids[1]! * 2]! +
            w2 * mapped[ids[2]! * 2]!;
          const av =
            w0 * mapped[ids[0]! * 2 + 1]! +
            w1 * mapped[ids[1]! * 2 + 1]! +
            w2 * mapped[ids[2]! * 2 + 1]!;
          if (!source) continue;
          const expected = bakeSample(
            sampleBilinear(source, su, sv, wrapU, wrapV),
            { color, opacity: factor[3]!, alphaMode, alphaCutoff: cutoff },
          );
          const actual = sampleAtlasLinear(atlas, au, av);
          errors.push(
            (Math.abs(expected[0] - actual[0]) +
              Math.abs(expected[1] - actual[1]) +
              Math.abs(expected[2] - actual[2])) /
              3,
          );
        }
      }
    }
  }
  errors.sort((a, b) => a - b);
  const mean = errors.length
    ? errors.reduce((sum, value) => sum + value, 0) / errors.length
    : 0;
  return {
    samples: errors.length,
    meanAbs: mean,
    p95: errors.length
      ? errors[Math.floor(errors.length * 0.95)] ?? 0
      : 0,
  };
}

const linearToSrgb = (value: number) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

/** Atlas texels a material's triangles map to (exact UV area × size²). */
function atlasTexels(document: Document, materialKey: string, size = 128): number {
  const keys = new Map<Material, string>();
  const seen = new Map<string, number>();
  for (const material of document.getRoot().listMaterials()) {
    const name = material.getName() || '(default)';
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    keys.set(material, `m:${name}#${index}`);
  }
  let texels = 0;
  for (const mesh of document.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      if (!material || keys.get(material) !== materialKey) continue;
      const uv = primitive.getAttribute('TEXCOORD_0');
      if (!uv) continue;
      const indices = primitive.getIndices();
      const indexArray = indices?.getArray();
      const count = indices ? Math.floor(indices.getCount() / 3) : Math.floor(uv.getCount() / 3);
      const value: number[] = [];
      const read = (vertex: number): [number, number] => {
        uv.getElement(vertex, value);
        return [value[0] ?? 0, value[1] ?? 0];
      };
      for (let t = 0; t < count; t++) {
        const a = read(indexArray ? indexArray[t * 3]! : t * 3);
        const b = read(indexArray ? indexArray[t * 3 + 1]! : t * 3 + 1);
        const c = read(indexArray ? indexArray[t * 3 + 2]! : t * 3 + 2);
        texels +=
          (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2) *
          size *
          size;
      }
    }
  return texels;
}

async function atlasOf(document: Document) {
  const result = await optimizeTextures(
    {
      document,
      source: {
        path: 'generated',
        format: 'gltf',
        units: 'meters',
        coordinates: 'right-handed-y-up',
        importer: 'gltf-transform',
      },
      warnings: [],
    },
    {
      compactSize: 128,
      padding: 1,
      atlasBudget: 'texel-retention',
    },
  );
  const { data, info } = await sharp(Buffer.from(result.png))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    result,
    atlas: {
      width: info.width,
      height: info.height,
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      key: 'atlas',
    } satisfies RgbaImage,
  };
}

/** Copy the largest node as a second part sharing its mesh (true instancing). */
function addInstance(document: Document): string {
  const root = document.getRoot();
  const nodes = root.listNodes().filter((node) => node.getMesh());
  const source = [...nodes].sort(
    (a, b) =>
      (b.getMesh()!.listPrimitives()[0]?.getIndices()?.getCount() ?? 0) -
      (a.getMesh()!.listPrimitives()[0]?.getIndices()?.getCount() ?? 0),
  )[0]!;
  const clone = document.createNode(`${source.getName() || 'part'}_accessory`);
  clone.setMesh(source.getMesh()!);
  const translation = source.getTranslation();
  clone.setTranslation([translation[0]! + 0.4, translation[1]!, translation[2]!]);
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('model has no scene');
  if (!root.getDefaultScene()) root.setDefaultScene(scene);
  scene.addChild(clone);
  return clone.getName();
}

/** Copy the largest primitive with the same material but a different UV region. */
function addUvRegion(document: Document): string {
  const root = document.getRoot();
  const nodes = root.listNodes().filter((node) => node.getMesh());
  const source = [...nodes].sort(
    (a, b) =>
      (b.getMesh()!.listPrimitives()[0]?.getIndices()?.getCount() ?? 0) -
      (a.getMesh()!.listPrimitives()[0]?.getIndices()?.getCount() ?? 0),
  )[0]!;
  const sourcePrimitive = source.getMesh()!.listPrimitives()[0]!;
  const mesh = document.createMesh(`${source.getName() || 'part'}_accessory_mesh`);
  const copy = sourcePrimitive.clone();
  copy.setMaterial(sourcePrimitive.getMaterial());
  const uv = copy.getAttribute('TEXCOORD_0');
  if (uv) {
    const values = new Float32Array(uv.getCount() * 2);
    const value: number[] = [];
    for (let i = 0; i < uv.getCount(); i++) {
      uv.getElement(i, value);
      values[i * 2] = 0.5 + (value[0] ?? 0) * 0.5;
      values[i * 2 + 1] = 0.5 + (value[1] ?? 0) * 0.5;
    }
    copy.setAttribute(
      'TEXCOORD_0',
      document
        .createAccessor()
        .setType('VEC2')
        .setArray(values)
        .setBuffer(root.listBuffers()[0]!),
    );
  }
  mesh.addPrimitive(copy);
  const node = document.createNode(`${source.getName() || 'part'}_accessory`);
  node.setMesh(mesh);
  node.setTranslation([0.4, 0, 0]);
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('model has no scene');
  if (!root.getDefaultScene()) root.setDefaultScene(scene);
  scene.addChild(node);
  return node.getName();
}

interface Row {
  model: string;
  scenario: string;
  accessory: string;
  removedPart: string;
  removedShare: number;
  trianglesBefore: number;
  trianglesAfter: number;
  contentBefore: number;
  contentAfter: number;
  errorBefore: number;
  errorAfter: number;
  referenceMaterial: string;
  referenceBefore: number;
  referenceAfter: number;
  othersBefore: number;
  othersAfter: number;
  samples: number;
}

const rows: Row[] = [];
await mkdir('.cache/research/v3', { recursive: true });

for (const path of MODELS) {
  const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  for (const scenario of ['instance', 'uv-region'] as const) {
    const base = await importModel(path);
    // Build the shared-material part on the un-prepared document.
    const accessory =
      scenario === 'instance' ? addInstance(base.document) : addUvRegion(base.document);
    const prepared = await prepareStaticModel(base);
    const parts = assignParts(prepared.model.document);
    const demands = partDemands(prepared.model.document);
    const byMaterial = new Map<string, number>();
    for (const part of parts)
      byMaterial.set(part.materialKey, (byMaterial.get(part.materialKey) ?? 0) + 1);
    const accessoryPart = parts.find((part) => part.node === accessory);
    if (!accessoryPart) {
      console.log(`[skip] ${name} ${scenario}: accessory part not found`);
      continue;
    }
    const sharedParts = byMaterial.get(accessoryPart.materialKey) ?? 1;
    const retained = parts.filter((part) => part.id !== accessoryPart.id);
    const captured = capture(prepared.model.document);

    // Run with the accessory.
    const withAccessory = await atlasOf(prepared.model.document);
    const accessoryPrimitive = accessoryPart.instancePart
      ? parts
          .filter((part) => part.node === accessoryPart.node)
          .map((part) => ({ node: part.node, primitive: Math.max(0, part.primitive) }))
      : [{ node: accessoryPart.node, primitive: accessoryPart.primitive }];
    const retainedPrimitives = retained
      .filter((part) => !part.instancePart || part.node !== accessoryPart.node)
      .map((part) => ({
        node: part.node,
        primitive: Math.max(0, part.primitive),
      }));
    const before = await measure(
      withAccessory.result.model.document,
      captured,
      withAccessory.atlas,
      128,
      retainedPrimitives,
    );
    const referencePart = retained
      .filter((part) => part.materialKey !== accessoryPart.materialKey)
      .sort((a, b) => b.triangles - a.triangles)[0];
    const referenceBefore = referencePart
      ? atlasTexels(withAccessory.result.model.document, referencePart.materialKey)
      : 0;

    // Run without it.
    const filtered = await prepareStaticModel(base);
    const report = filterParts(filtered.model.document, new Set(retained.map((part) => part.id)));
    const after = await atlasOf(filtered.model.document);
    const afterMeasure = await measure(
      after.result.model.document,
      captured,
      after.atlas,
      128,
      retainedPrimitives,
    );
    const trianglesAfter = retained.reduce((sum, part) => sum + part.triangles, 0);
    const referenceAfter = referencePart
      ? atlasTexels(after.result.model.document, referencePart.materialKey)
      : 0;
    // Budget reclaimed by the other materials: total content minus the
    // removed part's material. This is where deletion becomes visible even
    // when integer rounding keeps a single reference chart unchanged.
    const othersBefore =
      withAccessory.result.report.atlas.contentPixels -
      atlasTexels(withAccessory.result.model.document, accessoryPart.materialKey);
    const othersAfter =
      after.result.report.atlas.contentPixels -
      atlasTexels(after.result.model.document, accessoryPart.materialKey);

    rows.push({
      model: name,
      scenario,
      accessory,
      removedPart: accessoryPart.id,
      removedShare: sharedParts,
      trianglesBefore: parts.reduce((sum, part) => sum + part.triangles, 0),
      trianglesAfter,
      contentBefore: withAccessory.result.report.atlas.contentUtilization,
      contentAfter: after.result.report.atlas.contentUtilization,
      errorBefore: before.meanAbs,
      errorAfter: afterMeasure.meanAbs,
      referenceMaterial: referencePart?.materialName ?? '-',
      referenceBefore,
      referenceAfter,
      othersBefore,
      othersAfter,
      samples: afterMeasure.samples,
    });
    void demands;
    void report;
    void accessoryPrimitive;
    console.log(
      `[part] ${name} ${scenario}: removed ${accessoryPart.id} (material shared by ${sharedParts} parts) ` +
        `triangles ${rows.at(-1)!.trianglesBefore}->${trianglesAfter} ` +
        `content ${(rows.at(-1)!.contentBefore * 100).toFixed(1)}%->${(rows.at(-1)!.contentAfter * 100).toFixed(1)}% ` +
        `retained error ${before.meanAbs.toFixed(4)}->${afterMeasure.meanAbs.toFixed(4)} ` +
        `reference ${rows.at(-1)!.referenceMaterial} ${referenceBefore.toFixed(0)}->${referenceAfter.toFixed(0)}`,
    );
  }
}

await writeFile('.cache/research/v3/parts.json', JSON.stringify(rows, null, 2));
const header = [
  '| 模型 | 场景 | 删除部件 | 材质共享部件数 | 三角面 前→后 | content 前→后 | 保留部件误差 前→后 | 其他材质 texels 前→后 |',
  '|---|---|---|---|---|---|---|---|',
];
const lines = rows.map(
  (row) =>
    `| ${row.model} | ${row.scenario} | ${row.removedPart} | ${row.removedShare} | ${row.trianglesBefore} → ${row.trianglesAfter} | ${(row.contentBefore * 100).toFixed(1)}% → ${(row.contentAfter * 100).toFixed(1)}% | ${row.errorBefore.toFixed(4)} → ${row.errorAfter.toFixed(4)} | ${row.othersBefore.toFixed(0)} → ${row.othersAfter.toFixed(0)} (${(((row.othersAfter / row.othersBefore) - 1) * 100).toFixed(1)}%) |`,
);
await writeFile(
  'docs/research/texture-allocation-v3/data/stage2-parts.md',
  [...header, ...lines, ''].join('\n'),
);
console.log('[done] docs/research/texture-allocation-v3/data/stage2-parts.md');
