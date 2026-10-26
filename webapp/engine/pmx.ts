import type { Assimp } from 'libassimp';
import type * as THREE from 'three';
import { readPMXMaterials } from '../../src/pmx-metadata.ts';

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
  /** Original PMX material names, in material order. */
  materialNames: string[];
}

/**
 * Convert a PMX model to GLB in the browser with the libassimp WebAssembly
 * build, then reuse the existing glTF pipeline. PMX has no browser-native
 * loader, so this mirrors the desktop importer's Assimp path.
 */
export async function convertPmxModel(files: File[]): Promise<ConvertedPmx> {
  const pmd = files.find(isPmdModel);
  if (pmd) throw new Error(`暂不支持 PMD（${pmd.name}），请先转换为 PMX 2.0/2.1。`);
  const candidates = files.filter(isPmxModel).sort((a, b) => b.size - a.size);
  const main = candidates[0];
  if (!main) throw new Error('没有找到 PMX 文件。');

  const lookup = buildLookup(files);
  const missing = new Set<string>();
  const assimp = await getAssimp();

  let bytes: Uint8Array;
  let materialNames: string[] = [];
  try {
    const source = new Uint8Array(await main.arrayBuffer());
    const metadata = readPmxMetadata(source);
    // Assimp's glTF exporter writes external image URIs without asking for the
    // bytes, so compare the PMX texture table against the imported files to
    // report missing textures ourselves.
    for (const name of metadata?.textures ?? []) {
      if (name.trim() && !lookup.has(name)) missing.add(name);
    }
    materialNames = metadata?.materials.map((material) => material.name) ?? [];
    const result = await assimp.convert(
      { name: main.name, bytes: source },
      {
        to: 'glb',
        resolve: async (name) => {
          const found = await lookup.resolve(name);
          if (!found) missing.add(name);
          return found;
        },
      },
    );
    const output = result.files[0];
    if (!output?.bytes?.length) throw new Error('没有生成 GLB 输出');
    bytes = output.bytes;
  } catch (cause) {
    throw new Error(`PMX 转换失败：${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const warnings = ['PMX 按静态绑定姿势转换；骨骼动画、表情、物理和 toon 材质不会保留。'];
  if (candidates.length > 1)
    warnings.unshift(`检测到 ${candidates.length} 个 PMX，已加载体积最大的「${main.name}」。`);
  if (missing.size > 0) {
    const names = [...missing];
    warnings.push(
      `有 ${names.length} 个贴图没有在导入的文件里找到：${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等' : ''}。`,
    );
  }

  const glb = new File(
    [toArrayBuffer(bytes)],
    main.name.replace(PMX_PATTERN, '') + '.glb',
    { type: 'model/gltf-binary' },
  );
  return { file: glb, warnings, materialNames };
}

/**
 * Assimp names PMX materials Mat_Face/Mat_Hair/…, so restore the names from
 * the PMX material table. The GLB keeps one primitive per PMX material in
 * order, which makes first-seen material order stable.
 */
export function applyPmxMaterialNames(scene: THREE.Object3D, names: string[]): number {
  const materials: THREE.Material[] = [];
  const seen = new Set<THREE.Material>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material && !seen.has(material)) {
        seen.add(material);
        materials.push(material);
      }
    }
  });
  if (materials.length !== names.length) return 0;
  materials.forEach((material, index) => {
    const name = names[index]?.trim();
    if (name) material.name = name;
  });
  return materials.length;
}

function buildLookup(files: File[]) {
  const byPath = new Map<string, File>();
  const byBase = new Map<string, File>();
  for (const file of files) {
    if (isPmxModel(file) || isPmdModel(file)) continue;
    const path = relativePath(file);
    if (!byPath.has(path)) byPath.set(path, file);
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (!byBase.has(base)) byBase.set(base, file);
  }
  const paths = [...byPath.keys()];
  const cache = new Map<File, Uint8Array>();
  const find = (raw: string): File | undefined => {
    const path = normalizePath(raw);
    const base = path.slice(path.lastIndexOf('/') + 1);
    return byPath.get(path)
      ?? byBase.get(base)
      ?? byPath.get(paths.find((key) => key.endsWith(`/${path}`)) ?? '');
  };

  return {
    has: (raw: string) => !!find(raw),
    resolve: async (raw: string): Promise<Uint8Array | undefined> => {
      const file = find(raw);
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

function relativePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return normalizePath(relative || file.name);
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
