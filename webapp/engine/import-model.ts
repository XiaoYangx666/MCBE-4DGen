import * as THREE from 'three';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  MODEL_FORMAT_RANK,
  modelFormatOf,
  type ModelFormat as CandidateFormat,
} from '../../src/model-candidates.ts';
import { vrmHumanoidRoles } from './humanoid.ts';
import { normalizePath } from './paths.ts';
import { indexResources } from './resources.ts';
import { applyVrmMtoonMaterials } from './vrm-materials.ts';

/** Formats this loader can open directly; PMX is converted first, PMD is desktop-only. */
export type ModelFormat = Exclude<CandidateFormat, 'pmx' | 'pmd'>;

export interface LoadedModel {
  name: string;
  format: ModelFormat;
  scene: THREE.Object3D;
  warnings: string[];
  stats: { triangles: number; meshes: number; materials: number; textures: number };
  /** VRM 0.x/1.0 humanoid metadata, when the source provides it. */
  humanoidRoles?: Record<string, THREE.Object3D>;
  dispose: () => void;
}

export const MODEL_ACCEPT = '.glb,.gltf,.vrm,.pmx,.fbx,.obj,.dae,.stl,.ply,.zip';

export function formatOf(name: string): ModelFormat | null {
  const format = modelFormatOf(name);
  return format && format !== 'pmx' && format !== 'pmd' ? format : null;
}

/** Archive-relative path for a picked file, falling back to its base name. */
export function modelFilePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}

export interface LoadModelFilesOptions {
  /** Candidate path (or File) the user picked; defaults to the best candidate. */
  main?: string | File;
}

/** Load a model entirely in the browser. Sidecar buffers/textures are mapped by path or basename. */
export async function loadModelFiles(
  files: File[],
  options: LoadModelFilesOptions = {},
): Promise<LoadedModel> {
  const candidates = files
    .map((file) => ({ file, format: formatOf(file.name), path: modelFilePath(file) }))
    .filter((item): item is { file: File; format: ModelFormat; path: string } => item.format !== null)
    .sort((a, b) =>
      MODEL_FORMAT_RANK[a.format] - MODEL_FORMAT_RANK[b.format] ||
      a.path.localeCompare(b.path));
  if (!candidates.length) {
    throw new Error('没有找到支持的模型文件。请选择 GLB、glTF、VRM、FBX、OBJ、DAE、STL 或 PLY。');
  }
  const wanted = options.main;
  const main = wanted === undefined
    ? candidates[0]!
    : candidates.find((item) =>
        item.file === wanted || item.path === wanted || item.file.name === wanted);
  if (!main) {
    const label = typeof wanted === 'string' ? wanted : wanted?.name ?? '';
    throw new Error(`所选模型「${label}」不在导入的文件里。`);
  }
  const warnings: string[] = [];
  if (wanted === undefined && candidates.length > 1)
    warnings.push(`检测到 ${candidates.length} 个模型文件，已加载「${main.file.name}」。`);

  const urls = new Map<string, string>();
  const created: string[] = [];
  const register = (raw: string, url: string) => {
    const key = normalizePath(raw, { lowerCase: true });
    if (!key) return;
    if (!urls.has(key)) urls.set(key, url);
    const base = key.slice(key.lastIndexOf('/') + 1);
    if (base && !urls.has(base)) urls.set(base, url);
  };
  const index = indexResources(files, main.path);
  for (const file of index.files) {
    const url = URL.createObjectURL(file);
    created.push(url);
    register(modelFilePath(file), url);
    const local = index.localPath(file);
    if (local) register(local, url);
    register(file.name, url);
  }
  const mainUrl = urls.get(normalizePath(main.path, { lowerCase: true }))
    ?? urls.get(normalizePath(main.file.name, { lowerCase: true }))!;

  const known = new Set(created);
  const manager = new THREE.LoadingManager();
  let activeLoads = 0;
  let resolveIdle = () => { /* assigned below */ };
  const idle = new Promise<void>((resolve) => { resolveIdle = resolve; });
  const startItem = manager.itemStart.bind(manager);
  const endItem = manager.itemEnd.bind(manager);
  manager.itemStart = (url) => { activeLoads++; startItem(url); };
  manager.itemEnd = (url) => {
    endItem(url);
    activeLoads = Math.max(0, activeLoads - 1);
    if (activeLoads === 0) resolveIdle();
  };
  manager.onError = (url) => { warnings.push(`资源读取失败：${url}`); };
  const registered = [...urls.keys()];
  manager.setURLModifier((url) => {
    if (/^data:/i.test(url)) return url;
    // A blob URL created here is already the final resource. GLTFLoader also
    // resolves sidecars against a blob base, producing a different blob URL
    // whose basename still identifies the uploaded file.
    if (known.has(url)) return url;
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch { /* keep raw */ }
    const clean = normalizePath(decoded.split(/[?#]/)[0] ?? '', { lowerCase: true });
    const base = clean.slice(clean.lastIndexOf('/') + 1);
    const exact = urls.get(clean) ?? urls.get(base);
    if (exact) return exact;
    // Archives often wrap assets in an extra folder, so a reference like
    // "textures/body.png" may only exist as "model/textures/body.png".
    const suffix = registered.find((key) => key.endsWith(`/${clean}`));
    return suffix ? urls.get(suffix)! : url;
  });

  const revoke = () => { for (const url of created) URL.revokeObjectURL(url); };

  try {
    const { scene, format, humanoidRoles } = await parseModel(main.file, mainUrl, main.format, files, manager, warnings);
    // OBJ/MTL textures are started by preload() and may still be decoding when
    // OBJLoader resolves. Wait for the manager to go idle so stats and the
    // atlas see the actual images.
    if (activeLoads > 0) {
      const finished = await Promise.race([
        idle.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
      ]);
      if (!finished) warnings.push('部分贴图在 10 秒内未完成加载，导出可能缺少贴图。');
    }
    // Cameras and lights from imported scene files are irrelevant and can confuse framing.
    for (const child of [...scene.children]) {
      const item = child as THREE.Camera | THREE.Light;
      if ((item as THREE.Camera).isCamera || (item as THREE.Light).isLight) scene.remove(child);
    }
    const stats = collectStats(scene);
    if (!stats.meshes) throw new Error('模型里没有网格。');
    const name = main.file.name.replace(/\.[^.]+$/, '') || '我的 4D 皮肤';
    let disposed = false;
    return {
      name,
      format,
      scene,
      warnings,
      stats,
      ...(humanoidRoles && Object.keys(humanoidRoles).length ? { humanoidRoles } : {}),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        disposeScene(scene);
        revoke();
      },
    };
  } catch (error) {
    revoke();
    throw friendlyError(error);
  }
}

async function parseModel(
  file: File,
  url: string,
  format: ModelFormat,
  files: File[],
  manager: THREE.LoadingManager,
  warnings: string[],
): Promise<{
  scene: THREE.Object3D;
  format: ModelFormat;
  humanoidRoles?: Record<string, THREE.Object3D>;
}> {
  if (format === 'glb' || format === 'gltf') {
    const loader = new GLTFLoader(manager);
    try {
      await MeshoptDecoder.ready;
      loader.setMeshoptDecoder(MeshoptDecoder);
    } catch { /* decoder is optional; uncompressed files still load */ }
    const gltf = await loader.loadAsync(url);
    if (/\.vrm$/i.test(file.name))
      warnings.push('VRM 以 glTF 基础网格读取；脸和身体材质会保留，表情与物理不会进入输出。');
    // MToon 的真实颜色/透明/剔除写在扩展里，映射规则与桌面端共用。
    const mtoon = await applyVrmMtoonMaterials(gltf);
    if (mtoon.applied)
      warnings.push('VRM MToon 材质已按基础色、主贴图、透明度和双面映射；卡通光照、描边、rim/阴影贴图和 UV 动画不会保留。');
    if (mtoon.unmatched)
      warnings.push(`${mtoon.unmatched} 个 VRM MToon 材质在场景里没有对应对象，已保留 glTF 原始材质。`);
    const humanoidRoles = gltfHumanoidRoles(gltf);
    if (gltf.parser.json.extensions?.VRM || gltf.parser.json.extensions?.VRMC_vrm)
      warnings.push('已读取 VRM 人形骨骼，可用于六部位绑定。');
    return {
      scene: gltf.scene,
      format,
      ...(Object.keys(humanoidRoles).length ? { humanoidRoles } : {}),
    };
  }
  if (format === 'obj') {
    const loader = new OBJLoader(manager);
    const mtl = files.find((item) => /\.mtl$/i.test(item.name));
    if (mtl) {
      try {
        const mtlUrl = URL.createObjectURL(mtl);
        try {
          const materials = await new MTLLoader(manager).loadAsync(mtlUrl);
          materials.preload();
          loader.setMaterials(materials);
        } finally {
          URL.revokeObjectURL(mtlUrl);
        }
      } catch {
        warnings.push(`MTL 材质「${mtl.name}」读取失败，已使用基础材质。`);
      }
    } else {
      warnings.push('OBJ 没有配套 MTL 文件，将使用白色基础材质。');
    }
    return { scene: await loader.loadAsync(url), format };
  }
  if (format === 'fbx') {
    return { scene: await new FBXLoader(manager).loadAsync(url), format };
  }
  if (format === 'dae') {
    const collada = await new ColladaLoader(manager).loadAsync(url);
    if (!collada?.scene) throw new Error('DAE 场景为空');
    return { scene: collada.scene, format };
  }
  if (format === 'stl') {
    const geometry = new STLLoader(manager).parse(await file.arrayBuffer());
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    warnings.push('STL 不包含 UV 与贴图，将导出纯色 4D 皮肤。');
    return { scene: wrapGeometry(geometry), format };
  }
  if (format === 'ply') {
    const geometry = new PLYLoader(manager).parse(await file.arrayBuffer());
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const color = geometry.getAttribute('color');
    const material = new THREE.MeshStandardMaterial({
      color: color ? 0xffffff : 0xc8d2e4,
      vertexColors: !!color,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    if (color) warnings.push('PLY 顶点色无法写入 4D 皮肤贴图，将使用近似纯色。');
    warnings.push('PLY 不包含 UV 与贴图，将导出近似纯色的 4D 皮肤。');
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = file.name;
    const group = new THREE.Group();
    group.add(mesh);
    return { scene: group, format };
  }
  throw new Error(`暂不支持 ${format} 格式`);
}

/**
 * GLTFLoader keeps the raw glTF JSON and an object→asset association map. Use
 * both to turn VRM humanoid node indices into the nodes in the loaded scene.
 */
function gltfHumanoidRoles(gltf: {
  scene: THREE.Object3D;
  parser: {
    json: unknown;
    associations: Map<object, { nodes?: number }>;
  };
}): Record<string, THREE.Object3D> {
  const byIndex = new Map<number, THREE.Object3D>();
  for (const [object, association] of gltf.parser.associations) {
    if (typeof association?.nodes !== 'number') continue;
    if ((object as THREE.Object3D).isObject3D)
      byIndex.set(association.nodes, object as THREE.Object3D);
  }
  return vrmHumanoidRoles(gltf.parser.json, (index) => byIndex.get(index));
}

function wrapGeometry(geometry: THREE.BufferGeometry) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xc8d2e4,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function collectStats(scene: THREE.Object3D) {
  let triangles = 0, meshes = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;
    const index = mesh.geometry.getIndex();
    const position = mesh.geometry.getAttribute('position');
    triangles += Math.floor((index?.count ?? position?.count ?? 0) / 3);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      materials.add(material);
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map) textures.add(map);
    }
  });
  return { triangles, meshes, materials: materials.size, textures: textures.size };
}

function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function friendlyError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/draco|DRACOLoader/i.test(message))
    return new Error('模型使用 Draco 压缩，网页版暂不支持。请先解压为普通 glTF/GLB。');
  if (/ktx2|ktx|basis/i.test(message))
    return new Error('模型使用 KTX2/Basis 压缩贴图，网页版暂不支持。请转换为 PNG/JPEG 贴图。');
  if (/meshopt|setMeshoptDecoder/i.test(message))
    return new Error('模型的 Meshopt 压缩数据无法解码。');
  if (/fetch|404|not found|load/i.test(message) && /\.bin|\.png|\.jpg|\.jpeg/i.test(message))
    return new Error('缺少外部贴图或 .bin 文件。请把模型和同目录资源一起拖进来。');
  return new Error(`模型解析失败：${message}`);
}
