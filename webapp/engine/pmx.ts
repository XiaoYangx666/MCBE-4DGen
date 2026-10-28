import type { Assimp } from 'libassimp';
import { DoubleSide, FrontSide } from 'three';
import type * as THREE from 'three';
import { readPMXMaterials } from '../../src/pmx-metadata.ts';
import { planPmxMaterials, type PmxMaterialSource } from '../../src/pmx-materials.ts';
import { ASSIMP_IMPORT_POST_PROCESS } from '../../src/assimp-import.ts';
import { modelFilePath } from './import-model.ts';
import { reporter, type ProgressHandler } from './progress.ts';
import { indexResources } from './resources.ts';

const PMX_PATTERN = /\.pmx$/i;
const PMD_PATTERN = /\.pmd$/i;

let runtime: Promise<Assimp> | null = null;

async function getAssimp(): Promise<Assimp> {
  if (!runtime) {
    runtime = import('libassimp')
      .then(({ createAssimp }) => createAssimp({ backend: 'wasm' }))
      .catch((error) => {
        runtime = null;
        throw error;
      });
  }
  return runtime;
}

export function isPmxModel(file: File): boolean {
  return PMX_PATTERN.test(file.name);
}

export function isPmdModel(file: File): boolean {
  return PMD_PATTERN.test(file.name);
}

export interface ConvertedPmx {
  file: File;
  warnings: string[];
  /** PMX material table, applied to the loaded scene by `applyPmxMaterials`. */
  materials: PmxMaterialSource[];
}

export interface ConvertPmxOptions {
  /** Candidate path the user picked; defaults to the largest PMX. */
  main?: string;
  /** Stage updates for the busy UI. */
  onProgress?: ProgressHandler;
}

/**
 * Convert a PMX model to GLB in the browser with the libassimp WebAssembly
 * build, then reuse the existing glTF pipeline. PMX has no browser-native
 * loader, so this mirrors the desktop importer's Assimp path.
 */
export async function convertPmxModel(
  files: File[],
  options: ConvertPmxOptions = {},
): Promise<ConvertedPmx> {
  const pmd = files.find(isPmdModel);
  if (pmd) throw new Error(`暂不支持 PMD（${pmd.name}），请先转换为 PMX 2.0/2.1。`);
  const candidates = files.filter(isPmxModel).sort((a, b) => b.size - a.size);
  if (!candidates.length) throw new Error('没有找到 PMX 文件。');
  const picked = options.main === undefined
    ? undefined
    : candidates.find((file) => modelFilePath(file) === options.main || file.name === options.main);
  if (options.main !== undefined && !picked)
    throw new Error(`所选模型「${options.main}」不是 PMX 文件。`);
  const main = picked ?? candidates[0]!;

  const lookup = buildLookup(files, main);
  const missing = new Set<string>();
  const report = reporter(options.onProgress);
  if (!runtime) report('加载 PMX 转换引擎…', '首次使用约 12 MB WebAssembly');
  const assimp = await getAssimp();
  report('转换 PMX 模型…', `${(main.size / 1024 / 1024).toFixed(1)} MB`);

  let bytes: Uint8Array;
  let materials: PmxMaterialSource[] = [];
  try {
    const source = new Uint8Array(await main.arrayBuffer());
    const metadata = readPmxMetadata(source);
    // Assimp's glTF exporter writes external image URIs without asking for the
    // bytes, so compare the PMX texture table against the imported files to
    // report missing textures ourselves.
    for (const name of metadata?.textures ?? []) {
      if (name.trim() && !lookup.has(name)) missing.add(name);
    }
    materials = metadata?.materials.map((material) => ({
      name: material.name,
      alpha: material.alpha,
      doubleSided: material.doubleSided,
    })) ?? [];
    const result = await assimp.convert(
      { name: main.name, bytes: source },
      {
        to: 'glb',
        resolve: async (name) => {
          const found = await lookup.resolve(name);
          if (!found) missing.add(name);
          return found;
        },
        // Shared with the desktop importer; it skips Assimp's
        // `joinIdenticalVertices`, which takes minutes on MMD-sized models and
        // only changes vertex sharing. Both exporters work from triangle soup.
        postProcess: ASSIMP_IMPORT_POST_PROCESS,
      },
    );
    const output = result.files[0];
    if (!output?.bytes?.length) throw new Error('没有生成 GLB 输出');
    bytes = output.bytes;
  } catch (cause) {
    throw new Error(`PMX 转换失败：${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const warnings = ['PMX 按静态绑定姿势转换；骨骼动画、表情、物理和 toon 材质不会保留。'];
  if (options.main === undefined && candidates.length > 1)
    warnings.unshift(`检测到 ${candidates.length} 个 PMX，已加载体积最大的「${main.name}」。`);
  if (missing.size > 0) {
    const names = [...missing];
    warnings.push(
      `有 ${names.length} 个贴图没有在导入的文件里找到：${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等' : ''}。`,
    );
  }

  const glbName = main.name.replace(PMX_PATTERN, '') + '.glb';
  const glb = new File(
    [toArrayBuffer(bytes)],
    glbName,
    { type: 'model/gltf-binary' },
  );
  // Keep the PMX's folder so later sidecar lookups stay scoped to this model
  // when the archive also contains other models with the same texture names.
  const sourcePath = modelFilePath(main);
  const slash = sourcePath.lastIndexOf('/');
  if (slash >= 0)
    Object.defineProperty(glb, 'webkitRelativePath', { value: sourcePath.slice(0, slash + 1) + glbName });
  return { file: glb, warnings, materials };
}

/**
 * Apply the PMX material table to the converted scene: names, diffuse alpha,
 * and the double-sided draw flag that Assimp drops. Uses the same planner as
 * the Node importer; returns 0 when the counts do not line up.
 */
export function applyPmxMaterials(
  scene: THREE.Object3D,
  materials: readonly PmxMaterialSource[],
): number {
  const targets: THREE.Material[] = [];
  const seen = new Set<THREE.Material>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material && !seen.has(material)) {
        seen.add(material);
        targets.push(material);
      }
    }
  });
  const plan = planPmxMaterials(materials, targets.length);
  if (!plan) return 0;
  plan.forEach((entry, index) => {
    const target = targets[index]!;
    target.name = entry.name?.trim() || `材质 ${index + 1}`;
    target.side = entry.doubleSided ? DoubleSide : FrontSide;
    target.opacity = entry.alpha;
    // PMX has no OPAQUE/MASK switch: keep texture alpha and blend it.
    target.transparent = true;
    target.alphaTest = 0;
    target.needsUpdate = true;
  });
  return targets.length;
}

function buildLookup(files: File[], main: File) {
  const index = indexResources(files.filter((file) => !isPmxModel(file) && !isPmdModel(file)), modelFilePath(main));
  const cache = new Map<File, Uint8Array>();

  return {
    has: (raw: string) => !!index.find(raw),
    resolve: async (raw: string): Promise<Uint8Array | undefined> => {
      const file = index.find(raw);
      if (!file) return undefined;
      let bytes = cache.get(file);
      if (!bytes) {
        bytes = new Uint8Array(await file.arrayBuffer());
        cache.set(file, bytes);
      }
      return bytes;
    },
  };
}

function readPmxMetadata(bytes: Uint8Array) {
  try {
    return readPMXMaterials(bytes);
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
