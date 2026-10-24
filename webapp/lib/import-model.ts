import * as THREE from 'three';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'ply' | 'dae';

export interface LoadedModel {
  name: string;
  format: ModelFormat;
  scene: THREE.Object3D;
  warnings: string[];
  stats: { triangles: number; meshes: number; materials: number; textures: number };
  dispose: () => void;
}

const FORMATS: { extension: string; format: ModelFormat }[] = [
  { extension: 'glb', format: 'glb' },
  { extension: 'vrm', format: 'glb' },
  { extension: 'gltf', format: 'gltf' },
  { extension: 'fbx', format: 'fbx' },
  { extension: 'obj', format: 'obj' },
  { extension: 'dae', format: 'dae' },
  { extension: 'stl', format: 'stl' },
  { extension: 'ply', format: 'ply' },
];

export const MODEL_ACCEPT = '.glb,.gltf,.vrm,.fbx,.obj,.dae,.stl,.ply';

export function formatOf(name: string): ModelFormat | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return FORMATS.find((item) => item.extension === extension)?.format ?? null;
}

/** Load a model entirely in the browser. Sidecar buffers/textures are mapped by path or basename. */
export async function loadModelFiles(files: File[]): Promise<LoadedModel> {
  const candidates = files
    .map((file) => ({ file, format: formatOf(file.name) }))
    .filter((item): item is { file: File; format: ModelFormat } => !!item.format);
  if (!candidates.length) {
    throw new Error('没有找到支持的模型文件。请选择 GLB、glTF、VRM、FBX、OBJ、DAE、STL 或 PLY。');
  }
  const rank: Record<ModelFormat, number> = { glb: 0, gltf: 1, fbx: 2, obj: 3, dae: 4, stl: 5, ply: 6 };
  candidates.sort((a, b) => rank[a.format] - rank[b.format] || a.file.name.localeCompare(b.file.name));
  const main = candidates[0]!;
  const warnings: string[] = [];
  if (candidates.length > 1)
    warnings.push(`检测到 ${candidates.length} 个模型文件，已加载「${main.file.name}」。`);

  const urls = new Map<string, string>();
  const created: string[] = [];
  const register = (raw: string, url: string) => {
    const key = normalizePath(raw);
    if (!key) return;
    if (!urls.has(key)) urls.set(key, url);
    const base = key.slice(key.lastIndexOf('/') + 1);
    if (base && !urls.has(base)) urls.set(base, url);
  };
  for (const file of files) {
    const url = URL.createObjectURL(file);
    created.push(url);
    register(file.name, url);
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (relative) register(relative, url);
  }
  const mainUrl = urls.get(normalizePath(main.file.name))!;

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
  manager.setURLModifier((url) => {
    if (/^data:/i.test(url)) return url;
    // A blob URL created here is already the final resource. GLTFLoader also
    // resolves sidecars against a blob base, producing a different blob URL
    // whose basename still identifies the uploaded file.
    if (known.has(url)) return url;
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch { /* keep raw */ }
    const clean = normalizePath(decoded.split(/[?#]/)[0] ?? '');
    const base = clean.slice(clean.lastIndexOf('/') + 1);
    return urls.get(clean) ?? urls.get(base) ?? url;
  });

  const revoke = () => { for (const url of created) URL.revokeObjectURL(url); };

  try {
    const { scene, format } = await parseModel(main.file, mainUrl, main.format, files, manager, warnings);
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
): Promise<{ scene: THREE.Object3D; format: ModelFormat }> {
  if (format === 'glb' || format === 'gltf') {
    const loader = new GLTFLoader(manager);
    try {
      await MeshoptDecoder.ready;
      loader.setMeshoptDecoder(MeshoptDecoder);
    } catch { /* decoder is optional; uncompressed files still load */ }
    const gltf = await loader.loadAsync(url);
    if (/\.vrm$/i.test(file.name))
      warnings.push('VRM 以 glTF 基础网格读取，姿态为绑定姿势，不加载 VRM 骨骼与表情扩展。');
    return { scene: gltf.scene, format };
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

function normalizePath(value: string) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
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
